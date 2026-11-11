import { useState } from 'react';
import { readLink, type BotLink, type LinkAnswer, type LinkFailure, type LinkFolder, type Progress } from '../../runtime/import/link';
import { ACTS } from '../common/acts';
import { describeReplyError } from '../common/failure';
import { sizeText } from '../common/size';
import { UNREADABLE_FILE, WRONG_PASSWORD } from '../common/words';
import { Button, Checkbox, Dialog, List, ListItem, Stack, TextField, type ProgressStep } from '../ui';

// password: why a Proton link asks for its owner's password.
export type LinkStart = { text: string; password: 'asked' | 'wrong' | null };
// locked: the link asks for its password, again where one was wrong.
type Brought = { kind: 'files'; files: File[]; skipped: string[] } | { kind: 'folder'; folder: LinkFolder } | { kind: 'locked'; start: LinkStart } | { kind: 'failed'; failure: string } | { kind: 'cancelled' };

const linkFailure = (failure: Exclude<LinkFailure, { kind: 'cancelled' | 'needs-password' | 'wrong-password' }>) => {
  switch (failure.kind) {
    case 'missing': return '봇을 찾지 못했어요. 삭제됐거나 비공개일 수 있어요.';
    case 'refused': return '사이트에서 다운로드를 거절했어요. 잠시 뒤 다시 시도해 주세요.';
    case 'not-a-file': return '웹 페이지가 열리는 링크예요. 파일을 바로 받는 링크를 넣어 주세요.';
    case 'guest-blocked': return '이 사이트는 손님 모드에서 바로 가져올 수 없어요. 파일을 직접 받아서 넣어 주세요.';
    case 'needs-account': return 'Proton 링크는 손님 모드에서 가져올 수 없어요. 파일을 직접 받아서 넣어 주세요.';
    case 'no-bot-file': return '가져올 수 있는 파일이 없어요.';
    case 'damaged': return `${UNREADABLE_FILE} 링크가 잘렸거나 파일이 손상됐을 수 있어요.`;
    case 'lost': return '다운로드가 끊겼어요. 인터넷 연결을 확인해 주세요.';
    case 'relay': return describeReplyError(failure.failure);
  }
};

// download: the link's, or a folder's chosen files'. text: the link as typed, which a password retry opens the dialog
// with again.
export async function bringLink(download: (progress: Progress) => Promise<LinkAnswer>, text: string, show: (step: ProgressStep) => void): Promise<Brought> {
  const megabytes = (bytes: number) => Math.round(bytes / 1e6);
  const step = (done: number, total?: number): ProgressStep => ({ label: '다운로드 (MB)', done, ...(total !== undefined && { total }) });
  show(step(0));
  let last = 0;
  // Each step shown is a state that renders every useImport screen: once per megabyte, not once per network chunk.
  const answer = await download((done, total) => {
    if (megabytes(done) === last) return;
    last = megabytes(done);
    show(step(last, total === undefined ? undefined : megabytes(total)));
  });
  if (answer.ok) return 'folder' in answer ? { kind: 'folder', folder: answer.folder } : { kind: 'files', files: answer.files, skipped: answer.skipped };
  const { failure } = answer;
  if (failure.kind === 'cancelled') return { kind: 'cancelled' };
  if (failure.kind === 'needs-password' || failure.kind === 'wrong-password') return { kind: 'locked', start: { text, password: failure.kind === 'needs-password' ? 'asked' : 'wrong' } };
  return { kind: 'failed', failure: linkFailure(failure) };
}

export function LinkDialog({ start, onBring, onClose }: { start: LinkStart; onBring: (link: BotLink, text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(start.text);
  const [password, setPassword] = useState('');
  const link = readLink(text);
  const asking = start.password !== null && link?.kind === 'proton';
  const ready = link !== null && (!asking || password !== '');
  return (
    <Dialog
      title="링크로 가져오기"
      onClose={onClose}
      actions={<Button disabled={!ready} onClick={() => link && onBring(asking ? { ...link, password } : link, text)}>{ACTS.import.label}</Button>}
    >
      <Stack>
        <TextField
          label="봇 링크"
          value={text}
          onChange={setText}
          placeholder="https://realm.risuai.net/character/..."
          help="Realm 봇 링크, Proton Drive 공개 링크, 파일을 바로 받는 https 링크를 넣어요. Realm 외의 링크는 하루 사용량에 포함돼요."
          error={text.trim() !== '' && link === null ? 'https로 시작하는 링크를 넣어 주세요.' : undefined}
        />
        {asking && (
          <TextField
            label="링크 비밀번호"
            kind="current-password"
            value={password}
            onChange={setPassword}
            hint="헤이젤은 Proton 공식 앱이 아니에요. 비밀번호는 이 브라우저에서만 쓰여요."
            error={start.password === 'wrong' ? WRONG_PASSWORD : undefined}
          />
        )}
      </Stack>
    </Dialog>
  );
}

// ticked: one per file of the folder, whether it is downloaded.
export function FolderChoice({ folder, ticked, onTick }: { folder: LinkFolder; ticked: readonly boolean[]; onTick: (ticked: boolean[]) => void }) {
  return (
    <List label="받을 파일" box>
      {folder.files.map(({ name, size }, at) => (
        <ListItem
          key={at}
          title={name}
          description={size === undefined ? undefined : sizeText(size)}
          control={<Checkbox label={`${name} 받기`} hideLabel checked={ticked[at]!} onChange={(on) => onTick(ticked.map((each, index) => (index === at ? on : each)))} />}
        />
      ))}
    </List>
  );
}
