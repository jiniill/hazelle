import { Link2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { SHARE_CONSENT } from '../../contracts/shares';
import { publishShare, setShareCover } from '../../runtime/share';
import { agreeToShare, cutShare, readShares, shareLink, type SharedLink } from '../../runtime/share-link';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { count } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { useCopy } from '../common/useCopy';
import { useLoaded } from '../common/useLoaded';
import { SHARE, TOOL } from '../common/words';
import { useFiles, useShares, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Checkbox, Dialog, SettingRow, Stack, Switch, Text, TextField } from '../ui';

// What a sharer agrees to once per account, at SHARE_CONSENT: raise it when this text changes, and every sharer is
// asked again.
const BANNED = [
  '미성년자로 보이는 캐릭터의 성적인 묘사는 공유할 수 없어요. 직접 그린 이미지와 AI 이미지 모두 해당하고, 나이를 성인으로 적어 둬도 마찬가지예요.',
  '실존 인물의 성적인 합성물(딥페이크)',
  '공유할 권리가 없는 자료',
  '법에서 음란물로 보는 내용',
];
const AFTER_REPORT = '신고가 들어오면 링크가 바로 멈춰요. 운영자가 위반을 확인하면 같은 파일을 모든 계정에서 막고, 계정을 제재해요.';

// Character ⋯ › 링크로 공유: the consent once per account, then the character's one link.
export function ShareDialog({ character, name, onClose }: { character: string; name: string; onClose: () => void }) {
  const loaded = useLoaded(readShares);
  const [agreed, setAgreed] = useState(false);
  if (!loaded.data) {
    return (
      <Dialog title={SHARE.act} note={name} onClose={onClose}>
        {loaded.loading}
        {loaded.failure}
      </Dialog>
    );
  }
  if (loaded.data.consent !== SHARE_CONSENT && !agreed) return <ConsentDialog onAgreed={() => setAgreed(true)} onClose={onClose} />;
  return <LinkDialog character={character} name={name} links={loaded.data.shares} reload={loaded.reload} onClose={onClose} />;
}

function ConsentDialog({ onAgreed, onClose }: { onAgreed: () => void; onClose: () => void }) {
  const [checked, setChecked] = useState(false);
  const { busy, failure, run } = useAttempt();
  const agree = () =>
    run(async () => {
      const done = await agreeToShare();
      if (!done.ok) return describeFailure(done);
      onAgreed();
      return null;
    });
  return (
    <Dialog
      title="링크로 공유하기 전에"
      onClose={onClose}
      onSubmit={() => void agree()}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" busy={busy} disabled={!checked}>
            동의하고 계속
          </Button>
        </>
      }
    >
      <Stack gap="related">
        <Text>링크가 있는 사람은 누구나 열어 보고 파일을 받을 수 있어요. 아래에 해당하는 내용은 공유할 수 없어요.</Text>
        {BANNED.map((line) => (
          <Text key={line}>· {line}</Text>
        ))}
        <Text>{AFTER_REPORT}</Text>
      </Stack>
      <Checkbox label="내용을 읽었고 규칙을 지킬게요" checked={checked} onChange={setChecked} />
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
    </Dialog>
  );
}

function LinkDialog({ character, name, links, reload, onClose }: { character: string; name: string; links: SharedLink[]; reload: () => void; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const copy = useCopy();
  const own = useShares().find((share) => share.parent === character) ?? null;
  const link = own && links.find(({ id }) => id === own.value.share);
  const [covered, setCovered] = useState(false);
  const { busy, failure, run } = useAttempt();
  // Which press is under way, for its spinner; every control waits while one is.
  const [pressed, setPressed] = useState<'publish' | 'cut' | 'cover'>('publish');
  const spins = (press: typeof pressed) => busy && pressed === press;

  const publish = () => {
    setPressed('publish');
    void run(async (signal) => {
      // A link cut elsewhere still named in this account's vault is let go first; a new one takes its place.
      if (own && !link) {
        const cut = await cutShare(store, own.value.share);
        if (!cut.ok) return describeFailure(cut);
      }
      const published = await publishShare(store, files, character, link ? link.covered : covered, signal);
      if (!published.ok) return describeFailure(published);
      const tools = published.data.tools ? { detail: `${TOOL} ${published.data.tools}개는 빼고 공유했어요.` } : undefined;
      toast.show(link ? '새 버전으로 바꿨어요.' : '공유 링크를 만들었어요.', tools);
      reload();
      return null;
    });
  };

  const cut = () => {
    setPressed('cut');
    void run(async () => {
      const done = await cutShare(store, link!.id);
      if (!done.ok) return describeFailure(done);
      toast.show('공유 링크를 끊었어요.');
      onClose();
      return null;
    });
  };

  function cover(checked: boolean) {
    if (!own || !link) return setCovered(checked);
    setPressed('cover');
    void run(async () => {
      const done = await setShareCover(store, own, checked);
      if (!done.ok) return describeFailure(done);
      reload();
      return null;
    });
  }

  const address = own && link ? shareLink(location.origin, link.id, own.value.key) : null;
  return (
    <Dialog
      title={SHARE.act}
      note={name}
      onClose={onClose}
      actions={
        link ? (
          <>
            <Button variant="danger" icon={Unlink} busy={spins('cut')} disabled={busy} onClick={cut}>
              {SHARE.cut}
            </Button>
            <Button variant="secondary" busy={spins('publish')} disabled={busy || link.held || link.removed} onClick={publish}>
              {SHARE.update}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
            <Button icon={Link2} busy={spins('publish')} onClick={publish}>
              링크 만들기
            </Button>
          </>
        )
      }
    >
      <Stack gap="related">
        {address && (
          <TextField
            label="링크"
            kind="key"
            readOnly
            value={address}
            onChange={() => {}}
            action={
              <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(address)}>
                {ACTS.copy.label}
              </Button>
            }
          />
        )}
        {link?.held && <Callout tone="warn">{SHARE.heldNote}</Callout>}
        {link?.removed && <Callout tone="warn">{SHARE.removedNote}</Callout>}
        {link && <Text variant="note">{`${SHARE.received} ${count(link.received)} · 버전 ${count(link.version)}`}</Text>}
        <SettingRow
          label={SHARE.cover}
          help={SHARE.coverHelp}
          control={<Switch label={SHARE.cover} checked={link ? link.covered : covered} disabled={busy || Boolean(link?.removed)} onChange={cover} />}
        />
        {failure && <Callout tone="warn" alert>{failure}</Callout>}
      </Stack>
    </Dialog>
  );
}
