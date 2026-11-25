import { useState } from 'react';
import type { ConnectionType } from '../../connectors/types';
import { changeKey } from '../../runtime/models/connections';
import { describeKeyFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { KEY_VIEW } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Dialog } from '../ui';
import { KeyField } from './KeyField';
import { StoredKey } from './StoredKey';

// secret: the stored key, shown covered above an empty field for a new one. A 직접 연결 may hold none.
export function ConnectionKeyDialog({ id, type, secret: stored, onClose }: { id: string; type: ConnectionType | null; secret: string; onClose: () => void }) {
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
      title={KEY_VIEW}
      onClose={onClose}
      onSubmit={submit}
      actionsLayout="full"
      actions={
        <Button type="submit" busy={busy} disabled={!ready}>
          저장
        </Button>
      }
    >
      {stored && <StoredKey label="저장된 키" secret={stored} lines={type?.keyForm?.lines} />}
      <KeyField type={type} value={key} onChange={setKey} />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
