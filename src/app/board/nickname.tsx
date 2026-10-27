import { Check } from 'lucide-react';
import { useState } from 'react';
import { NICKNAME_LENGTH, validNickname } from '../../contracts/board';
import { readNickname, setNickname } from '../../runtime/board';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { BOARD } from '../common/words';
import { useAccount, useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Dialog, TextField } from '../ui';

// Cache chosen nicknames only; keep asking until one exists. Key by username across accounts; operator is fixed.
const known = new Map<string, string>();
export const knowNickname = (username: string, name: string) => known.set(username, name);

const BAD = describeFailure({ ok: false, error: 'bad-nickname' });

export function NicknameDialog({ current, onSet, onClose }: { current: string | null; onSet: (name: string) => void; onClose: () => void }) {
  const { username } = useSession();
  const [name, setName] = useState(current ?? '');
  const [taken, setTaken] = useState<string | null>(null);
  const { busy, failure, run } = useAttempt();
  const typed = name.trim();
  const bad = typed !== '' && !validNickname(typed);
  const submit = () =>
    run(async () => {
      const set = await setNickname(typed);
      if (!set.ok && set.error === 'nickname-taken') {
        setTaken(typed);
        return null;
      }
      if (!set.ok) return describeFailure(set);
      knowNickname(username, typed);
      onSet(typed);
      return null;
    });
  return (
    <Dialog
      title={current === null ? `${BOARD.nickname} 정하기` : `${BOARD.nickname} 바꾸기`}
      note="게시판에 쓴 글과 댓글에 보여요. 아이디는 보이지 않아요."
      onClose={onClose}
      onSubmit={() => void submit()}
      actions={
        <Button type="submit" icon={Check} busy={busy} disabled={typed === '' || bad || typed === current}>
          저장
        </Button>
      }
    >
      <TextField
        label={BOARD.nickname}
        value={name}
        onChange={setName}
        hint={`${NICKNAME_LENGTH.min}~${NICKNAME_LENGTH.max}자`}
        error={bad ? BAD : taken === typed ? describeFailure({ ok: false, error: 'nickname-taken' }) : undefined}
      />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}

// Before the first 글쓰기, 댓글 or 추천: an account without a nickname picks one, then the act goes on.
export function useNicknameGate() {
  const { username } = useSession();
  const { guest } = useAccount();
  const toast = useToast();
  const [pending, setPending] = useState<(() => void) | null>(null);
  async function gate(then: () => void) {
    if (guest) return then();
    if (known.has(username)) return then();
    const read = await readNickname();
    if (!read.ok) return toast.failed(read, '닉네임을 확인하지 못했어요.');
    if (read.data.name === null) return setPending(() => then);
    knowNickname(username, read.data.name);
    then();
  }
  const dialog = pending && (
    <NicknameDialog
      current={null}
      onSet={() => {
        setPending(null);
        pending();
      }}
      onClose={() => setPending(null)}
    />
  );
  return { gate: (then: () => void) => void gate(then), dialog };
}
