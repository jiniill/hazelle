import { useState } from 'react';
import { SHARE_ID } from '../../contracts/shares';
import { holdShare, releaseShare } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { useToast } from '../toast';
import { Button, Callout, Dialog, TextField } from '../ui';

// 보류 by a share's id, for what the operator learns without a report; 보류 풀기 marks the share reviewed.
export function HoldShareDialog({ onClose, onActed }: { onClose: () => void; onActed: () => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const { busy, failure, run } = useAttempt();
  // A whole link is taken too: its id is between /s/ and #.
  const id = /\/s\/([^/#?]+)/.exec(typed)?.[1] ?? typed.trim();
  const valid = SHARE_ID.test(id);

  const act = (hold: boolean) =>
    run(async () => {
      const done = await (hold ? holdShare(id) : releaseShare(id));
      if (!done.ok) return done.error === 'not-found' ? (hold ? '없거나 보류된 링크예요.' : '없는 링크이거나 차단된 링크예요.') : describeFailure(done);
      toast.show(hold ? '링크를 보류했어요.' : '링크 보류를 해제했어요.', { detail: id });
      onActed();
      return null;
    });

  return (
    <Dialog
      title="링크 보류"
      onClose={onClose}
      actions={<>
        <Button variant="danger" busy={busy} disabled={!valid} onClick={() => void act(true)}>보류</Button>
        <Button variant="secondary" busy={busy} disabled={!valid} onClick={() => void act(false)}>보류 해제</Button>
      </>}
    >
      <TextField label="링크 ID" kind="key" value={typed} onChange={setTyped} placeholder="16자 ID 또는 링크" error={typed && !valid ? '링크 ID를 찾지 못했어요.' : undefined} />
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
    </Dialog>
  );
}
