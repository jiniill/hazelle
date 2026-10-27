import { writePersonaPng } from '../engine/import/persona';
import type { Picture, RisuPersona } from '../engine/import/types';
import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import type { Persona } from '../model/persona';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { BackupOutput } from './backup-zip';
import { writeWhole } from './export-file';
import { pngOf, thumbnail } from './picture';
import { markDeleted } from './removal';
import { without } from '../model/fields';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';

// Fixed, so two devices adding the first persona at once meet in a version conflict instead of making two.
export const FIRST_ID = '00000000-0000-4000-8000-000000000002';

// Saved chats keep their persona; picking changes that chat and current persona.
// Only unsaved chats follow character pin, then current persona.
export type PersonaSource = 'chat' | 'character' | 'current';

// There is no chat without a persona; a deleted one, or a current one not added yet, reads as missing and never as
// another persona, and a turn stops on it.
export type PersonaChoice = { kind: 'persona'; persona: Stored<'persona'>; from: PersonaSource } | { kind: 'missing'; from: PersonaSource };

function followed(store: Pick<ObjectStore, 'get'>, chat: Pick<Chat, 'character' | 'persona'>): [PersonaSource, string | undefined] {
  const pinned = chat.character === null ? undefined : store.get('character', chat.character)?.value.persona;
  return chat.persona !== undefined ? ['chat', chat.persona] : pinned !== undefined ? ['character', pinned] : ['current', store.get('settings', SETTINGS_ID)?.value.persona];
}

export function chatPersona(store: Pick<ObjectStore, 'get'>, chat: Pick<Chat, 'character' | 'persona'>): PersonaChoice {
  const [from, id] = followed(store, chat);
  const persona = id === undefined ? null : live(store.get('persona', id));
  return persona ? { kind: 'persona', persona, from } : { kind: 'missing', from };
}

// The chat as saved: with the persona it reads now, a missing 고정 included, so it reads the same after a pick elsewhere.
export function withPersona(store: Pick<ObjectStore, 'get'>, chat: Chat): Chat {
  const [, id] = followed(store, chat);
  return id === undefined ? chat : { ...chat, persona: id };
}

// Backfill old chats, including binned ones, before a pick changes their inherited persona.
// Write unheld: changed revs stale summaries, rebuilt on next open.
export async function recordChatPersonas(store: ObjectStore): Promise<void> {
  const writes: Write[] = store.list('chat').flatMap(({ id, value }) => {
    if (value.persona !== undefined) return [];
    const recorded = withPersona(store, value);
    return recorded.persona === undefined ? [] : [{ type: 'restore' as const, kind: 'chat' as const, id, parent: null, value: recorded }];
  });
  if (writes.length) await store.batch(writes, undefined, { unheld: true });
}

export const chatsHolding = (store: Pick<ObjectStore, 'list'>, persona: string): string[] => store.list('chat').flatMap((chat) => (live(chat)?.value.persona === persona ? [chat.id] : []));

// Move only the supplied chat ids; undo must not capture other chats later assigned the persona. Write unheld.
export async function rebindChats(store: ObjectStore, ids: string[], persona: string): Promise<ApiResult<null>> {
  const writes: Write[] = ids.flatMap((id) => {
    const chat = live(store.get('chat', id));
    return chat ? [{ type: 'restore' as const, kind: 'chat' as const, id, parent: null, value: { ...chat.value, persona } }] : [];
  });
  return writes.length ? store.batch(writes, undefined, { unheld: true }) : { ok: true, data: null };
}

export const pinPersona = (store: ObjectStore, character: string, persona: string | null) =>
  store.update('character', character, (current) => (persona === null ? without(current, 'persona') : { ...current, persona }));

// An account that has never had a current persona gets one named after its username, once. The session
// awaits it when it opens; a failure is tried again next time.
export async function addFirstPersona(store: ObjectStore, username: string): Promise<void> {
  if (store.get('settings', SETTINGS_ID)?.value.persona !== undefined) return;
  if (!store.get('persona', FIRST_ID)) {
    const saved = await store.create('persona', { name: username, description: '', picture: null }, { id: FIRST_ID });
    if (!saved.ok) return;
  }
  await store.upsert('settings', (current = EMPTY_SETTINGS) => (current.persona === undefined ? { ...current, persona: FIRST_ID } : current));
}

export const addPersona = (store: ObjectStore, persona: Persona, id?: string) => store.create('persona', persona, { id });

// From a Risu backup (runtime/move) or a Risu persona PNG. A picture that does not shrink leaves it without one.
export async function addRisuPersona(store: ObjectStore, { name, alias, description }: Pick<RisuPersona, 'name' | 'alias' | 'description'>, picture: Picture | null, modules: string[] = []) {
  const thumb = picture && (await thumbnail(picture).catch(() => null));
  return addPersona(store, { name, description, picture: thumb, ...(alias && { alias }), ...(modules.length > 0 && { modules }) });
}

export const editPersona = (store: ObjectStore, id: string, patch: Partial<Persona>) => store.update('persona', id, (current) => ({ ...current, ...patch }));

// Risu's persona file; its picture redrawn as PNG runs only in a browser. unreadable: the picture did not open.
export async function exportPersona(persona: Persona, output: BackupOutput): Promise<ApiResult<null>> {
  const png = await pngOf(persona.picture).catch(() => null);
  if (png) return writeWhole(output, writePersonaPng(png, persona));
  await output.abort();
  return { ok: false, error: 'unreadable' };
}

// To 휴지통 (model/library Mark). The current persona goes only once another is picked.
export async function removePersona(store: ObjectStore, id: string): Promise<ApiResult<Stored<'persona'>> | { ok: false; error: 'current' }> {
  if (store.get('settings', SETTINGS_ID)?.value.persona === id) return { ok: false, error: 'current' };
  return markDeleted(store, 'persona', id, Date.now());
}

export const restorePersona = (store: ObjectStore, id: string) => markDeleted(store, 'persona', id, null);

export const setCurrentPersona = (store: ObjectStore, id: string) => store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, persona: id }));
