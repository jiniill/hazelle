import { KeyRound, Plug } from 'lucide-react';
import type { ConnectionType } from '../../connectors/types';
import { providerConnection } from '../../runtime/models/connections';
import { useAttempt } from '../common/useAttempt';
import { useConnections, useSession } from '../session';
import { navigate } from '../shell/router';
import { Callout, ConfirmDialog } from '../ui';
import { connect, CONNECT_KEY, keyOf } from './connect';

// A key pasted outside any field. One already saved opens its connection rather than making a second.
export function PastedKeyDialog({ type, secret, onClose }: { type: ConnectionType; secret: string; onClose: () => void }) {
  const session = useSession();
  const held = useConnections().find(({ value }) => value.accounts.some((account) => account.secret === secret));
  const { busy, failure, run } = useAttempt();

  if (held) return (
    <ConfirmDialog
      title={keyOf(type)}
      confirm="연결 열기"
      icon={Plug}
      onConfirm={() => {
        onClose();
        navigate({ kind: 'connection', id: held.id }, { replace: true });
      }}
      onClose={onClose}
    >
      '{held.value.label}' 연결에 있는 키예요.
    </ConfirmDialog>
  );
  return (
    <ConfirmDialog
      title={keyOf(type)}
      confirm={CONNECT_KEY}
      icon={KeyRound}
      busy={busy}
      onConfirm={() =>
        void run(async (signal) => {
          const failed = await connect(session, providerConnection(type, secret), signal);
          if (!failed) onClose();
          return failed;
        })
      }
      onClose={onClose}
      field={failure && <Callout tone="warn" alert>{failure}</Callout>}
    >
      새 연결로 추가할까요?
    </ConfirmDialog>
  );
}
