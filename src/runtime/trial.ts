import { fitsRole } from '../connectors/assignment';
import type { Connection, ConnectionType, Model } from '../connectors/types';
import type { CatalogResult } from './catalog';
import { startChat } from './chat-log';
import { addConnection, addModel, providerConnection, type KeyFailure } from './connections';
import { openGuestSession, type Session } from './session';
import { takeTurn, type TurnFailure } from './turn';
import type { ApiFailure, ApiResult } from './api';

// The first visitor's page does what the app's own screens do, on this browser's guest: the connection, the model and
// the chat are the real ones, so the app opens on them with nothing to bring over.
export const openTrial = (signal: AbortSignal): Promise<ApiResult<Session>> => openGuestSession(signal);

export async function connectTrial(session: Session, type: ConnectionType, secret: string, signal: AbortSignal): Promise<{ ok: true; id: string; catalog: CatalogResult } | { ok: false; failure: KeyFailure }> {
  const added = await addConnection(session, providerConnection(type, secret), signal);
  if (!added.ok) return added;
  const connection: Connection = session.store.get('connection', added.id)!.value;
  return { ok: true, id: added.id, catalog: await session.catalogs.load(connection) };
}

export const talkableModels = (models: Model[]) => models.filter((model) => fitsRole(model, 'main'));

export const pickTrialModel = (session: Session, connection: string, model: Model) => addModel(session.store, connection, model);

export function startTrialChat(session: Session, id: string, text: string): Promise<TurnFailure | null> {
  const saved: Promise<ApiFailure | null> = startChat(session.store, id, { title: null, character: null, models: {} }, null);
  return takeTurn(session, id, { kind: 'send', text }, { greeting: null, saved });
}

export const sayInTrial = (session: Session, id: string, text: string): Promise<TurnFailure | null> => takeTurn(session, id, { kind: 'send', text });
