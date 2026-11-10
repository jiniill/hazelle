import { fitsRole } from '../../connectors/assignment';
import type { Connection, ConnectionType, Model } from '../../connectors/types';
import type { CatalogResult } from '../models/catalog';
import { blankCard } from '../../engine/import/card';
import { addCharacter, setAvatar } from '../library/characters';
import { startChat } from '../chat/chat-log';
import { addConnection, addModel, providerConnection, type KeyFailure } from '../models/connections';
import { projectGreetings } from '../chat/greetings';
import { openGuestSession, openThrowawaySession, type Session } from '../session';
import { takeTurn, type TurnFailure } from '../chat/turn';
import type { ApiFailure, ApiResult } from '../api';

// The first visitor's page does what the app's own screens do, on this browser's guest: the connection, the model and
// the chat are the real ones, so the app opens on them with nothing to bring over.
// kept false: someone walking the page again, whose own data this must not touch.
export const openTrial = (signal: AbortSignal, kept: boolean): Promise<ApiResult<Session>> => (kept ? openGuestSession(signal) : openThrowawaySession(signal));

export async function connectTrial(session: Session, type: ConnectionType, secret: string, signal: AbortSignal): Promise<{ ok: true; id: string; catalog: CatalogResult } | { ok: false; failure: KeyFailure }> {
  const added = await addConnection(session, providerConnection(type, secret), signal);
  if (!added.ok) return added;
  const connection: Connection = session.store.get('connection', added.id)!.value;
  return { ok: true, id: added.id, catalog: await session.catalogs.load(connection) };
}

export const talkableModels = (models: Model[]) => models.filter((model) => fitsRole(model, 'main'));

export const pickTrialModel = (session: Session, connection: string, model: Model) => addModel(session.store, connection, model);

export type TrialCharacter = { name: string; description: string; greeting: string; picture: () => Promise<Uint8Array<ArrayBuffer>> };

export function startTrialChat(session: Session, id: string, text: string, { name, description, greeting, picture }: TrialCharacter): Promise<TurnFailure | null> {
  const character = crypto.randomUUID();
  const added = addCharacter(session.store, { card: { ...blankCard(name), description, greetings: [greeting] }, folder: null, loreFolders: [] }, { avatar: null, assets: [], lore: [], likeness: null }, () => {}, { id: character });
  // A character without her picture still talks.
  void added.then((kept) => (kept.ok ? picture().then((bytes) => setAvatar(session.store, session.files, character, bytes)) : null)).catch(() => {});
  const greetings = projectGreetings([greeting], [crypto.randomUUID()], null)!;
  const saved: Promise<ApiFailure | null> = added.then((kept) => (kept.ok ? startChat(session.store, id, { title: null, character, models: {} }, greetings) : kept));
  return takeTurn(session, id, { kind: 'send', text }, { greeting: greetings.choices[0]!.id, saved });
}

export const sayInTrial = (session: Session, id: string, text: string): Promise<TurnFailure | null> => takeTurn(session, id, { kind: 'send', text });
