import { useState } from 'react';
import { FILE_ID } from '../../contracts/files';
import { setFileBlocked } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { useToast } from '../toast';
import { Button, Callout, Dialog, TextField } from '../ui';

// A block refuses the file to every account; its body stays, so lifting the block brings it back.
export function BlockFileDialog({ onClose, onActed }: { onClose: () => void; onActed: () => void }) {
  const toast = useToast();
  const [id, setId] = useState('');
  const { busy, failure, run } = useAttempt();
  const typed = id.trim().toLowerCase();
  const valid = FILE_ID.test(typed);

  const block = (blocked: boolean) =>
    run(async () => {
      const done = await setFileBlocked(typed, blocked);
      if (!done.ok) return done.error === 'not-found' ? '서버에 없는 파일이에요.' : describeFailure(done);
      toast.show(blocked ? '파일을 차단했어요.' : '파일 차단을 해제했어요.', { detail: typed });
      onActed();
      return null;
    });

  return (
    <Dialog
      title="파일 차단"
      onClose={onClose}
      actions={<>
        <Button variant="danger" busy={busy} disabled={!valid} onClick={() => void block(true)}>차단</Button>
        <Button variant="secondary" busy={busy} disabled={!valid} onClick={() => void block(false)}>차단 해제</Button>
      </>}
    >
      <TextField label="파일 ID" kind="key" value={id} onChange={setId} placeholder="64자리 16진수" error={typed && !valid ? '파일 ID는 64자리 16진수여야 해요.' : undefined} />
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
    </Dialog>
  );
}
