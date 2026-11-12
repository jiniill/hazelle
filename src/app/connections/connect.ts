import { GENERIC } from '../../connectors/registry';
import type { Connection, ConnectionType, Protocol } from '../../connectors/types';
import { addConnection, newAccount } from '../../runtime/models/connections';
import type { Session } from '../../runtime/session';
import { describeKeyFailure } from '../common/failure';
import { navigate } from '../shell/router';
import { PICK_MODEL } from '../common/words';

// signal: the screen was left. Nothing is saved after that, and a save already on its way opens nothing.
export async function connect(session: Session, connection: Connection, signal: AbortSignal): Promise<string | null> {
  const added = await addConnection(session, connection, signal);
  if (!added.ok) return describeKeyFailure(added.failure);
  if (!signal.aborted) navigate({ kind: 'connection', id: added.id }, { replace: true });
  return null;
}

// A key whose type its form told, pasted into 새 연결's search or anywhere in the app.
export const keyOf = (type: ConnectionType) => `${type.label} 키`;
export const KEY_OPTIONAL = '키가 필요 없으면 비워 둬도 돼요.';
export const CONNECT_KEY = `이 키로 연결하고 ${PICK_MODEL}`;

export const directConnection = (label: string, baseUrl: string, protocol: Protocol, secret: string): Connection => ({
  type: GENERIC,
  label,
  baseUrl,
  protocol,
  accounts: [newAccount(secret)],
  turns: null,
  starred: [],
});
