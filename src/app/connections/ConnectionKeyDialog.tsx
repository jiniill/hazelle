import { useState } from 'react';
import type { ConnectionType } from '../../connectors/types';
import { changeKey } from '../../runtime/connections';
import { describeKeyFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Dialog } from '../ui';
import { KeyField } from './KeyField';

// The stored key is never shown, so the field starts empty.
export function ConnectionKeyDialog({ id, type, onClose }: { id: string; type: ConnectionType | null; onClose: () => void }) {
  const session = useSession();
  const toast = useToast();
  const [key, setKey] = useState('');
  const { busy, failure, run } = useAttempt();
  const secret = key.trim();
  const ready = secret !== '' || type === null;

  function submit() {
    if (!ready) return;
    void run(async (signal) => {
      const failed = await changeKey(session, id, secret, signal);
      if (failed) return describeKeyFailure(failed);
      toast.show('키를 바꿨어요.');
      onClose();
      return null;
    });
  }

  return (
    <Dialog
      title="키 변경"
      onClose={onClose}
      onSubmit={submit}
      actionsLayout="full"
      actions={
        <Button type="submit" busy={busy} disabled={!ready}>
          저장
        </Button>
      }
    >
      <KeyField type={type} value={key} onChange={setKey} />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
