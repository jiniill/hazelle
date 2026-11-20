import { fitsRole } from '../../connectors/assignment';
import { isFree } from '../../connectors/pricing';
import type { Connection, ConnectionType, LeftMeter, Model } from '../../connectors/types';
import type { CatalogResult } from '../models/catalog';
import { addStarter, type Starter } from '../library/characters';
import { startChat } from '../chat/chat-log';
import { addConnection, addModel, providerConnection, type KeyFailure } from '../models/connections';
import { projectGreetings } from '../chat/greetings';
import { openGuestSession, openThrowawaySession, type Session } from '../session';
import { takeTurn, type TurnFailure } from '../chat/turn';
import type { ApiFailure, ApiResult } from '../api';

// The first visitor's page does what the app's own screens do, on this browser's guest: the connection, the model and
// the chat are the real ones, so the app opens on them with nothing to bring over.
// kept false: someone walking the page again, whose own data this must not touch.
export const openTrial = (signal: AbortSignal, kept: boolean, starter: Starter): Promise<ApiResult<Session>> => (kept ? openGuestSession(signal, undefined, { starter }) : openThrowawaySession(signal, { starter }));

export async function connectTrial(session: Session, type: ConnectionType, secret: string, signal: AbortSignal): Promise<{ ok: true; id: string; catalog: CatalogResult } | { ok: false; failure: KeyFailure }> {
  const added = await addConnection(session, providerConnection(type, secret), signal);
  if (!added.ok) return added;
  const connection: Connection = session.store.get('connection', added.id)!.value;
  return { ok: true, id: added.id, catalog: await session.catalogs.load(connection) };
}

// Free ones first, each part in the catalog's order: a visitor who has paid a provider nothing gets a reply from those.
export function talkableModels(models: Model[]): Model[] {
  const fit = models.filter((model) => fitsRole(model, 'main'));
  return [...fit.filter(isFree), ...fit.filter((model) => !isFree(model))];
}

// What the free models may still ask today; null where the connection's type reports no such allowance or the read
// failed. fresh: asked again, after a reply has drawn on it.
export async function freeAllowance(session: Session, connection: string, fresh: boolean): Promise<LeftMeter | null> {
  const value: Connection = session.store.get('connection', connection)!.value;
  const read = await session.credentials.pool.meters(value, value.accounts[0]!, { fresh });
  return read?.meters.find((meter): meter is LeftMeter => meter.kind === 'left' && meter.free === true) ?? null;
}

export const pickTrialModel = (session: Session, connection: string, model: Model) => addModel(session.store, connection, model);

export function startTrialChat(session: Session, id: string, text: string, starter: Starter): Promise<TurnFailure | null> {
  const added = addStarter(session.store, session.files, starter);
  const greetings = projectGreetings([starter.greeting], [crypto.randomUUID()], null)!;
  const saved: Promise<ApiFailure | null> = added.then((kept) => (kept.ok ? startChat(session.store, id, { title: null, character: kept.data, models: {} }, greetings) : kept));
  return takeTurn(session, id, { kind: 'send', text }, { greeting: greetings.choices[0]!.id, saved });
}

export const sayInTrial = (session: Session, id: string, text: string): Promise<TurnFailure | null> => takeTurn(session, id, { kind: 'send', text });
