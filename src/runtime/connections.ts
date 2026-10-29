import { fitsRole } from '../connectors/assignment';
import { RETRIES } from '../connectors/registry';
import type { ModelSettings } from '../connectors/settings';
import { entriesOf, entryKey, ownOf, seesPictures, snapshotOf, type Account, type Connection, type ConnectionType, type Model, type Starred, type Turns } from '../connectors/types';
import { isRecord } from '../connectors/values';
import type { Stored } from '../model/kinds';
import { without } from '../model/fields';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import { firstTurns, groupOf, putBack, removeAccount as withoutAccount, signedIn } from '../model/turns';
import type { ApiFailure, ApiResult } from './api';
import { imageOnly, setDefaultModel } from './assignment';
import { modelProfile, ownProfile } from './profiles';
import type { CatalogFailure } from './catalog';
import type { MetersFailure } from './meters';
import type { Session } from './session';
import type { ObjectStore } from './store';

export const newAccount = (secret: string, name?: string): Account => ({ id: crypto.randomUUID(), secret, ...(name !== undefined && { name }) });

// name: who signed in. A pool starts with the account alone in its first group.
export function providerConnection(type: ConnectionType, secret: string, name?: string): Connection {
  const account = newAccount(secret, name);
  return { type: type.id, label: type.label, baseUrl: null, protocol: null, accounts: [account], turns: type.pool ? firstTurns(crypto.randomUUID(), account.id) : null, starred: [] };
}

// models: the model list did not load. key: the provider refused the key every meters request asked with.
// stopped: the caller gave up (signal) before the save.
export type KeyFailure =
  | { kind: 'models'; failure: CatalogFailure }
  | { kind: 'key'; failure: MetersFailure }
  | { kind: 'save'; failure: ApiFailure }
  | { kind: 'stopped' };

// Load models before saving; public catalogs do not validate keys, so unanimous meter 401s also block the save.
// One subscription-meter refusal is inconclusive (NanoGPT); other meter failures stay on the next screen.
// Leaving this screen while checks run must save nothing.
async function checkKey({ catalogs, credentials }: Session, connection: Connection, signal?: AbortSignal): Promise<KeyFailure | null> {
  // Asked first, so a pool's pick for the model list reads these same meters.
  const metered = credentials.pool.meters(connection, connection.accounts[0]!, { fresh: true });
  const [catalog, meters] = await Promise.all([catalogs.load(connection, { fresh: true }), metered]);
  if (signal?.aborted) return { kind: 'stopped' };
  if (!catalog.ok) return { kind: 'models', failure: catalog.failure };
  const refused = meters && !meters.meters.length && meters.failures.length > 0 && meters.failures.every((failure) => failure.kind === 'provider' && failure.status === 401) ? meters.failures[0] : undefined;
  return refused ? { kind: 'key', failure: refused } : null;
}

export async function addConnection(session: Session, connection: Connection, signal?: AbortSignal): Promise<{ ok: true; id: string } | { ok: false; failure: KeyFailure }> {
  const failure = await checkKey(session, connection, signal);
  if (failure) return { ok: false, failure };
  const saved = await session.store.create('connection', { ...connection, label: freeLabel(connection.label, session.store.list('connection')) });
  return saved.ok ? { ok: true, id: saved.data.id } : { ok: false, failure: { kind: 'save', failure: saved } };
}

// A pool's accounts change by signing in again, never here. The account keeps its id, so nothing that names it changes.
export async function changeKey(session: Session, id: string, secret: string, signal?: AbortSignal): Promise<KeyFailure | null> {
  const current = session.store.get('connection', id)!.value;
  const failure = await checkKey(session, { ...current, accounts: [{ ...current.accounts[0]!, secret }] }, signal);
  if (failure) return failure;
  const saved = await session.store.update('connection', id, (latest) => (pooled(latest) ? null : { ...latest, accounts: [{ ...latest.accounts[0]!, secret }] }));
  return saved.ok ? null : { kind: 'save', failure: saved };
}

// A second connection of one type would read as the first everywhere its label names it: menus, the list, usage.
// Renamed connections are not renumbered; a name the user picks stays theirs, taken or not.
function freeLabel(label: string, connections: readonly Stored<'connection'>[]): string {
  const taken = new Set(connections.map(({ value }) => value.label));
  let number = 1;
  let free = label;
  while (taken.has(free)) free = `${label} ${++number}`;
  return free;
}

export const renameConnection = (store: ObjectStore, id: string, label: string) => store.update('connection', id, (current) => ({ ...current, label }));

// The model id restores existing references; copies use addCopy's key. Deduplicate by key because lost responses retry.
// The first chat-capable model fills an unset 대화 모델 so chats can send immediately.
export async function addModel(store: ObjectStore, id: string, model: Model, own: Pick<Starred, 'label' | 'profile' | 'entry' | 'pictures'> = {}): Promise<ApiResult<string>> {
  const key = own.entry ?? model.id;
  const saved = await store.update('connection', id, (current) =>
    current.starred.some((each) => entryKey(each) === key) ? current : { ...current, starred: [...current.starred, { ...snapshotOf(model), ...own }] });
  if (!saved.ok) return saved;
  if (fitsRole(model, 'main') && !store.get('settings', SETTINGS_ID)?.value.models.main) await setDefaultModel(store, 'main', { connection: id, model: key });
  return { ok: true, data: key };
}

// A blank name is none, so the entry's name follows the list again.
function ownLabel(label: string): Pick<Starred, 'label'> {
  const trimmed = label.trim();
  return trimmed ? { label: trimmed } : {};
}

// Each copy needs its own cloned profile or edits would affect the original. Image-only models have none.
// Vision support is model-wide and keeps the first entry's user affirmation.
export async function addCopy(store: ObjectStore, id: string, model: Model, label: string): Promise<ApiResult<string>> {
  const connection = store.get('connection', id);
  const first = connection && entriesOf(connection.value, model.id)[0];
  const own = { ...ownLabel(label), ...(first?.pictures && { pictures: true as const }) };
  const entry = `#${crypto.randomUUID()}`;
  if (!first || imageOnly(first)) return addModel(store, id, model, { ...own, entry });
  const choice = modelProfile(store, first);
  const made = await ownProfile(store, { name: model.name, ...own }, choice.kind === 'profile' ? choice.profile.value.settings : {});
  return made.ok ? addModel(store, id, model, { ...own, profile: made.data, entry }) : made;
}

// What removeModel took, for putModelBack: the entry whole, so its key, name and 설정 come back with it and every
// reference to it names it again.
type TakenModel = { entry: Starred; index: number };

export async function removeModel(store: ObjectStore, id: string, key: string): Promise<ApiResult<TakenModel>> {
  let taken: TakenModel | null = null;
  const saved = await store.update('connection', id, (current) => {
    const index = current.starred.findIndex((model) => entryKey(model) === key);
    // Gone on a later try: the first one landed and only its answer was lost, so the entry it took is still the one to
    // put back.
    if (index < 0) return taken ? current : null;
    taken = { entry: current.starred[index]!, index };
    return { ...current, starred: current.starred.toSpliced(index, 1) };
  });
  return saved.ok ? { ok: true, data: taken! } : saved;
}

// A key already there (put back by a try whose answer was lost, or added again meanwhile) is not doubled.
export const putModelBack = (store: ObjectStore, id: string, { entry, index }: TakenModel) =>
  store.update('connection', id, (current) => (current.starred.some((model) => entryKey(model) === entryKey(entry)) ? current : { ...current, starred: current.starred.toSpliced(index, 0, entry) }));

export const renameModel = (store: ObjectStore, id: string, key: string, label: string) =>
  store.update('connection', id, (current) => ({ ...current, starred: current.starred.map((model) => (entryKey(model) === key ? { ...without(model, 'label'), ...ownLabel(label) } : model)) }));

export const setModelPictures = (store: ObjectStore, id: string, key: string, on: boolean) =>
  store.update('connection', id, (current) => ({ ...current, starred: current.starred.map((model) => (entryKey(model) !== key ? model : on ? { ...model, pictures: true as const } : without(model, 'pictures'))) }));

// Key order aside, so a snapshot written in another order is not taken for a change.
const sameValue = (a: unknown, b: unknown) => {
  const sorted = (value: unknown) => JSON.stringify(value, (_, field: unknown) => (isRecord(field) ? Object.fromEntries(Object.entries(field).sort(([x], [y]) => (x < y ? -1 : 1))) : field));
  return sorted(a) === sorted(b);
};

// Preserve ownOf fields and unlisted snapshots. Missing prices/modalities/tool support retain known values:
// an unavailable models.dev catalog must not erase them.
export async function refreshStarred(store: ObjectStore, id: string, models: Model[]): Promise<void> {
  const loaded = new Map(models.map((model) => [model.id, model]));
  const fresh = (model: Starred): Starred => {
    const listed = loaded.get(model.id);
    if (!listed) return model;
    return {
      ...listed,
      input: listed.input ?? model.input,
      output: listed.output ?? model.output,
      tools: listed.tools ?? model.tools,
      ...(listed.price === undefined && model.price !== undefined && { price: model.price }),
      ...ownOf(model),
    };
  };
  if (store.get('connection', id)?.value.starred.every((model) => sameValue(fresh(model), model)) !== false) return;
  await store.update('connection', id, (current) => ({ ...current, starred: current.starred.map(fresh) }));
}

// Old snapshots may predate models.dev inputs; refresh unknown vision support here unless the user already affirmed it.
export async function seesPicturesNow({ store, catalogs }: Pick<Session, 'store' | 'catalogs'>, { connection, model }: { connection: Stored<'connection'>; model: Starred }): Promise<boolean> {
  if (model.input !== null || model.pictures) return seesPictures(model);
  const listed = await catalogs.load(connection.value);
  if (!listed.ok) return false;
  await refreshStarred(store, connection.id, listed.models);
  return seesPictures(listed.models.find(({ id }) => id === model.id) ?? model);
}

// Most specific first: the model's 설정 묶음, then its connection, then the account's shared count.
export const retriesOf = (store: ObjectStore, connection: Connection, settings: ModelSettings) =>
  settings.retries ?? connection.retries ?? store.get('settings', SETTINGS_ID)?.value.retries ?? RETRIES;

// undefined: follow the account's shared count again.
export const setRetries = (store: ObjectStore, id: string, retries: number | undefined) =>
  store.update('connection', id, (current) => (retries === undefined ? without(current, 'retries') : { ...current, retries }));

// The default count is kept as none, so it follows the default.
export const setSharedRetries = (store: ObjectStore, retries: number) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (retries === RETRIES ? without(current, 'retries') : { ...current, retries }));

export const removeConnection = (store: ObjectStore, id: string) => store.take('connection', id);

export const restoreConnection = (store: ObjectStore, removed: Stored<'connection'>) => store.restore(removed);

type Pooled = Connection & { turns: Turns };
const pooled = (connection: Connection): connection is Pooled => connection.turns !== null;

// A pool's groups and their turns (model/turns); a change that answers null writes nothing.
export const changeTurns = (store: ObjectStore, id: string, change: (turns: Turns) => Turns | null) =>
  store.update('connection', id, (current) => {
    const turns = current.turns && change(current.turns);
    return turns ? { ...current, turns } : null;
  });

export const addAccount = (store: ObjectStore, id: string, account: Account) =>
  store.update('connection', id, (current) => (pooled(current) ? signedIn(current, account, Date.now()) : null));

// What removeAccount took, for putAccountBack.
type Taken = { account: Account; group: string; index: number };

export async function removeAccount(store: ObjectStore, id: string, account: string): Promise<ApiResult<Taken>> {
  let taken: Taken | null = null;
  const saved = await store.update('connection', id, (current) => {
    const group = current.turns && groupOf(current.turns, account);
    const held = current.accounts.find((entry) => entry.id === account);
    if (!pooled(current) || !group || !held) return null;
    taken = { account: held, group: group.id, index: group.accounts.indexOf(account) };
    return withoutAccount(current, account);
  });
  return saved.ok ? { ok: true, data: taken! } : saved;
}

export const putAccountBack = (store: ObjectStore, id: string, { account, group, index }: Taken) =>
  store.update('connection', id, (current) => (pooled(current) ? putBack(current, account, group, index, Date.now()) : null));
