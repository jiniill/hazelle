import { assetType, blankCard, imageType } from '../engine/import/card';
import { isVideo } from '../engine/assets';
import { add, counted, type Tally } from '../engine/import/convert';
import { UNSUPPORTED_KINDS, type Card, type Imported, type Pack, type Picture, type Unsupported } from '../engine/import/types';
import type { Translation, TranslateSwitches } from '../model/chat';
import type { IllustrateSwitches, Rung } from '../model/illustration';
import type { Stored, Values } from '../model/kinds';
import { readableTexts, type Asset, type Avatar, type Character, type Lore, type Pictures } from '../model/library';
import { likenessId, type Likeness } from '../model/likeness';
import type { ToggleValues } from '../model/prompt';
import { ORDER_ID, rearrange, toFront } from '../model/order';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { inOrder, type Files } from './files';
import { thumbnail } from './picture';
import { markDeleted } from './removal';
import { without } from '../model/fields';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';

export type Progress = (step: { kind: 'picture' } | { kind: 'assets' | 'saving'; done: number; total: number }) => void;

type Owned = { avatar: Avatar | null; assets: Asset[]; lore: Lore[]; likeness: Likeness | null };

// Files are read this many at a time and each window saved as one, so a bot of thousands never holds them all at once.
const FILE_WINDOW = 32;

// Write owned rows, move chat roots, then character: only complete characters become skippable on retry.
// store.commit packs backward so roots share the character request unless count/bytes push them out.
// unheld leaves chat leases/summaries to runtime/move until publication; id/chats refer to its staged rows.
export async function addCharacter(store: ObjectStore, character: Character, { avatar, assets, lore, likeness }: Owned, progress: Progress, { id = crypto.randomUUID(), chats = [] }: { id?: string; chats?: Write[] } = {}): Promise<ApiResult<string>> {
  const owned = <K extends 'avatar' | 'asset' | 'lore'>(kind: K, value: Values[K]): Write => ({ type: 'create', kind, id: crypto.randomUUID(), parent: id, value });
  const writes: Write[] = [
    { type: 'create', kind: 'character', id, parent: null, value: character },
    ...(avatar ? [owned('avatar', avatar)] : []),
    ...assets.map((asset) => owned('asset', asset)),
    ...lore.map((entry) => owned('lore', entry)),
    ...(likeness ? [{ type: 'create' as const, kind: 'likeness' as const, id: likenessId(id), parent: id, value: likeness }] : []),
    ...chats,
  ];
  let done = 0;
  progress({ kind: 'saving', done, total: writes.length });
  const result = await store.batch(writes, () => progress({ kind: 'saving', done: ++done, total: writes.length }), { unheld: true });
  return result.ok ? { ok: true, data: id } : result;
}

// unsupported: the assets not kept, counted by why (engine/import types), the parser's own counts apart.
// Both import entrances use faceless for thumbnail failures and refused uploads, not absent source pictures.
export type ImportedCharacter = { id: string; unsupported: Unsupported; faceless: boolean };

// Pipeline read/upload windows, retaining at most two. typeOf null skips a file; inlays allow pictures/signatures only.
export async function saveAssets(files: Files, assets: Imported['assets'], progress: Progress, typeOf: (bytes: Uint8Array) => string | null = assetType, signal?: AbortSignal): Promise<ApiResult<{ kept: Asset[]; unsupported: Unsupported }>> {
  const kept: Asset[] = [];
  const tally: Tally = new Map();
  const saveWindow = async (start: number) => {
    const window = await Promise.all(assets.slice(start, start + FILE_WINDOW).map(async ({ name, read }) => ({ name, bytes: await read() })));
    const read = window.flatMap(({ name, bytes }) => {
      const type = bytes && typeOf(bytes);
      if (!bytes) add(tally, 'missing-asset');
      else if (!type) add(tally, 'unsupported-file');
      return type ? [{ name, type, bytes: bytes! }] : [];
    });
    return { read, saved: await files.save(read.map(({ bytes }) => bytes), { bulk: true, signal }) };
  };
  const starts = Array.from({ length: Math.ceil(assets.length / FILE_WINDOW) }, (_, index) => index * FILE_WINDOW);
  for await (const [start, { read, saved }] of inOrder(starts, saveWindow, { ahead: 2 })) {
    progress({ kind: 'assets', done: start, total: assets.length });
    if (!saved.ok) return saved;
    read.forEach(({ name, type, bytes }, index) => {
      const file = saved.data[index];
      if (file) kept.push({ name, type, size: bytes.length, file });
      else add(tally, isVideo(type) ? 'refused-video' : 'refused-picture');
    });
  }
  if (assets.length) progress({ kind: 'assets', done: assets.length, total: assets.length });
  return { ok: true, data: { kept, unsupported: counted(UNSUPPORTED_KINDS, tally) } };
}

// A picture whose thumbnail cannot be made, and one the server refuses: too large, blocked, or past the account's
// picture cap (runtime/files Files.save).
const FACELESS = new Set(['picture-unreadable', 'picture-refused']);

async function savedAvatar(files: Files, picture: Picture): Promise<ApiResult<Avatar>> {
  const thumb = await thumbnail(picture).catch(() => null);
  if (thumb === null) return { ok: false, error: 'picture-unreadable' };
  const saved = await files.save([picture.bytes]);
  if (!saved.ok) return saved;
  const [file] = saved.data;
  return file ? { ok: true, data: { type: picture.type, size: picture.bytes.length, thumb, file } } : { ok: false, error: 'picture-refused' };
}

// The old file stays held: a copy (copyCharacter) may still name it, so only the sweep after a removal for good weighs
// it (runtime/files).
export async function setAvatar(store: ObjectStore, files: Files, id: string, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<Stored<'avatar'>>> {
  if (!store.get('character', id)) return { ok: false, error: 'gone' };
  const type = imageType(bytes);
  if (!type) return { ok: false, error: 'picture-unreadable' };
  const saved = await savedAvatar(files, { bytes, type });
  if (!saved.ok) return saved;
  const held = store.children('avatar', id)[0];
  return held ? store.update('avatar', held.id, () => saved.data) : store.create('avatar', saved.data, { parent: id });
}

// owner: the character or module the files join, each named by its file's name without the extension.
export async function addAssets(store: ObjectStore, files: Files, owner: string, picked: Pick<File, 'name' | 'arrayBuffer'>[]): Promise<ApiResult<{ added: number; unsupported: Unsupported }>> {
  const assets = picked.map((file) => ({ name: file.name.replace(/\.[^.]+$/, '') || file.name, read: async () => new Uint8Array(await file.arrayBuffer()) }));
  const saved = await saveAssets(files, assets, () => {});
  if (!saved.ok) return saved;
  const { kept, unsupported } = saved.data;
  if (kept.length) {
    const written = await store.batch(kept.map((asset): Write => ({ type: 'create', kind: 'asset', id: crypto.randomUUID(), parent: owner, value: asset })));
    if (!written.ok) return written;
  }
  return { ok: true, data: { added: kept.length, unsupported } };
}

// The name stays, so what the bot's text shows by it becomes the new file. The old file stays held, as for setAvatar.
export async function replaceAsset(store: ObjectStore, files: Files, id: string, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<Stored<'asset'>>> {
  const type = assetType(bytes);
  if (!type) return { ok: false, error: 'picture-unreadable' };
  const saved = await files.save([bytes]);
  if (!saved.ok) return saved;
  const [file] = saved.data;
  return file ? store.update('asset', id, (current) => ({ ...current, type, size: bytes.length, file })) : { ok: false, error: 'picture-refused' };
}

export const renameAsset = (store: ObjectStore, id: string, name: string) => store.update('asset', id, (current) => ({ ...current, name }));
// The files stay held, as for setAvatar. removed: what restoreAssets brings back.
export async function removeAssets(store: ObjectStore, ids: readonly string[]): Promise<ApiResult<Stored<'asset'>[]>> {
  const removed = ids.flatMap((id) => store.get('asset', id) ?? []);
  const written = await store.batch(removed.map(({ id }): Write => ({ type: 'remove', id })));
  return written.ok ? { ok: true, data: removed } : written;
}

export const restoreAssets = (store: ObjectStore, removed: readonly Stored<'asset'>[]) =>
  store.batch(removed.map(({ id, kind, parent, value }): Write => ({ type: 'restore', id, kind, parent, value })));

// A moved character's id is already named by its staged entries; chats: their roots (runtime/chat-log chatWrites).
type Brought = { id: string; folder: string | null; risu: string; toggles: ToggleValues; chats: Write[] };

// modules: those on for it: a moved character's, the ids its Risu modules were moved to (runtime/move), or a card file's
// bundled ones, saved before it (runtime/card-file).
export async function importCharacter(
  store: ObjectStore,
  files: Files,
  { card, lore, loreFolders, assets, own = null }: Pick<Imported, 'card' | 'lore' | 'loreFolders' | 'assets'> & Partial<Pick<Imported, 'own'>>,
  picture: Picture | null,
  progress: Progress,
  brought?: Brought,
  modules: string[] = [],
): Promise<ApiResult<ImportedCharacter>> {
  let avatar: Avatar | null = null;
  if (picture) {
    progress({ kind: 'picture' });
    const saved = await savedAvatar(files, picture);
    if (!saved.ok && !FACELESS.has(saved.error)) return saved;
    if (saved.ok) avatar = saved.data;
  }
  const stored = await saveAssets(files, assets, progress);
  if (!stored.ok) return stored;
  const { kept, unsupported } = stored.data;
  const folders = loreFolders.map((name) => ({ id: crypto.randomUUID(), name }));
  const entries = lore.map((entry) => ({ ...entry, folder: entry.folder === null ? null : folders[entry.folder]!.id }));
  const character: Character = { card, folder: brought?.folder ?? null, loreFolders: folders, ...own?.character, ...(brought && { risu: brought.risu }), ...(modules.length > 0 && { modules }), ...(brought && Object.keys(brought.toggles).length > 0 && { toggles: brought.toggles }) };
  const likeness = own?.likeness ? { ...own.likeness, receipt: null } : null;
  const added = await addCharacter(store, character, { avatar, assets: kept, lore: entries, likeness }, progress, brought && { id: brought.id, chats: brought.chats });
  return added.ok ? { ok: true, data: { id: added.data, unsupported, faceless: picture !== null && avatar === null } } : added;
}

// Copies share stored files/profiles but leave chats and alias with the original; never pay to regenerate copied profiles.
export async function copyCharacter(store: ObjectStore, id: string, name: string, progress: Progress): Promise<ApiResult<string>> {
  const failed = await store.pull();
  if (failed) return failed;
  const original = store.get('character', id)?.value;
  if (!original) return { ok: false, error: 'gone' };
  const owned = {
    avatar: store.children('avatar', id)[0]?.value ?? null,
    assets: store.children('asset', id).map((asset) => asset.value),
    lore: store.children('lore', id).map((entry) => entry.value),
    likeness: store.get('likeness', likenessId(id))?.value ?? null,
  };
  return addCharacter(store, { ...without(original, 'alias'), card: { ...original.card, name }, origin: { id, name: original.card.name } }, owned, progress);
}

export const createCharacter = (store: ObjectStore, name: string, id: string) =>
  addCharacter(store, { card: blankCard(name), folder: null, loreFolders: [] }, { avatar: null, assets: [], lore: [], likeness: null }, () => {}, { id });

export const setDeleted = (store: ObjectStore, id: string, at: number | null) => markDeleted(store, 'character', id, at);

export type CharacterText = Omit<Card, keyof Pack> & { alias: string };

// Only the fields given, the card's merged into the current card, so an edit to another field on another device
// survives.
export function editCharacter(store: ObjectStore, id: string, { alias, ...card }: Partial<CharacterText>): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => ({ ...current, ...(alias === undefined ? {} : { alias }), card: { ...current.card, ...card } }));
}

// Only the fields given; undefined removes one, back to its default.
export function setPictures(store: ObjectStore, id: string, patch: Partial<Pictures>): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => {
    const pictures = Object.fromEntries(Object.entries({ ...current.pictures, ...patch }).filter(([, value]) => value !== undefined));
    return Object.keys(pictures).length ? { ...current, pictures } : without(current, 'pictures');
  });
}

export function setDecor(store: ObjectStore, id: string, decor: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => ({ ...current, decor }));
}

export function setStatusScript(store: ObjectStore, id: string, script: string, on: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => {
    const rest = (current.statusScripts ?? []).filter((each) => each !== script);
    return { ...current, statusScripts: on ? [...rest, script] : rest };
  });
}

export function setCardWrites(store: ObjectStore, id: string, cardWrites: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => (current.deleted === undefined ? { ...current, cardWrites } : null));
}

// A blank one leaves the card without a background, as an import of a card without one does.
export function setBackground(store: ObjectStore, id: string, html: string): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => {
    if (current.deleted !== undefined) return null;
    return { ...current, card: html.trim() ? { ...current.card, background: html } : without(current.card, 'background') };
  });
}

export function setKeepThoughts(store: ObjectStore, id: string, keep: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => (keep ? { ...current, keepThoughts: true } : without(current, 'keepThoughts')));
}

// A toggle's value for a character's chats, or with character null for 캐릭터 없이's.
export function setToggle(store: ObjectStore, character: string | null, key: string, value: string): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, toggles: { ...current.toggles, [key]: value } }));
  return store.update('character', character, (current) => ({ ...current, toggles: { ...current.toggles, [key]: value } }));
}

// Seed the pre-existing displayed order once so shipping manual order does not move the rail.
// A concurrent device's seed wins.
export async function seedOrder(store: ObjectStore, ids: string[]): Promise<void> {
  if (store.get('order', ORDER_ID)) return;
  await store.upsert('order', (current) => current ?? { ids });
}

export const setOrder = (store: ObjectStore, sequence: string[]) => store.upsert('order', (current) => ({ ids: rearrange(current?.ids ?? [], sequence) }));

export const orderFirst = (store: ObjectStore, ids: string[]) => store.upsert('order', (current) => ({ ids: toFront(current?.ids ?? [], ids) }));

export function pinToggle(store: ObjectStore, key: string, pinned: boolean): Promise<ApiResult<Stored<'settings'>>> {
  return store.upsert('settings', (current = EMPTY_SETTINGS) => {
    const keys = (current.pinnedToggles ?? []).filter((each) => each !== key);
    if (pinned) keys.push(key);
    return keys.length ? { ...current, pinnedToggles: keys } : without(current, 'pinnedToggles');
  });
}

// What a switch not stored reads as. Switches stored before 반전 모드, the languages and the prompt choice existed
// hold none of those, and read as these.
const TRANSLATE_DEFAULTS = { replies: false, input: false, reverse: false, original: false, replyLanguage: 'Korean', inputLanguage: 'English' };

// 번역's and 삽화's switches: shared by every chat (Settings), or a character's own copy in their place (캐릭터별 설정).
const OWN = { translate: 'ownTranslate', illustrate: 'ownIllustrate' } as const;
type Scoped = keyof typeof OWN;
type SwitchesOf = { translate: TranslateSwitches; illustrate: IllustrateSwitches };
const FILL: { [S in Scoped]: (saved: SwitchesOf[S] | undefined, change?: Partial<SwitchesOf[S]>) => SwitchesOf[S] } = {
  translate: (saved, change = {}) => ({ replies: TRANSLATE_DEFAULTS.replies, input: TRANSLATE_DEFAULTS.input, ...saved, ...change }),
  illustrate: (saved, change = {}) => ({ ...saved, ...change }),
};

function scoped<S extends Scoped>(store: Pick<ObjectStore, 'get'>, character: string | null, scope: S): { switches: SwitchesOf[S] | undefined; own: boolean } {
  const own = character === null ? undefined : (store.get('character', character)?.value[OWN[scope]] as SwitchesOf[S] | undefined);
  return { switches: own ?? (store.get('settings', SETTINGS_ID)?.value[scope] as SwitchesOf[S] | undefined), own: own !== undefined };
}

// Only the switches given, merged into the ones a chat of character reads: its own, or else the shared ones. A field
// given as undefined goes back to its default.
function setScoped<S extends Scoped>(store: ObjectStore, character: string | null, scope: S, change: Partial<SwitchesOf[S]>): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  const fill = FILL[scope] as (saved: SwitchesOf[S] | undefined, change?: Partial<SwitchesOf[S]>) => SwitchesOf[S];
  const own = OWN[scope];
  if (character !== null && store.get('character', character)?.value[own]) {
    return store.update('character', character, (current) => ({ ...current, [own]: fill(current[own] as SwitchesOf[S], change) }));
  }
  return store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, [scope]: fill(current[scope] as SwitchesOf[S] | undefined, change) }));
}

// On starts from the shared switches as they are; off follows them again.
function setOwnScoped<S extends Scoped>(store: ObjectStore, character: string, scope: S, own: boolean): Promise<ApiResult<Stored<'character'>>> {
  const fill = FILL[scope] as (saved: SwitchesOf[S] | undefined) => SwitchesOf[S];
  const copy = fill(store.get('settings', SETTINGS_ID)?.value[scope] as SwitchesOf[S] | undefined);
  return store.update('character', character, (current) => (own ? { ...current, [OWN[scope]]: copy } : without(current, OWN[scope])));
}

// Reverse disables input translation regardless of saved input. Absent prompt follows the account translation default.
// Readers must still apply the feature switch (runtime/features chatTranslate).
export type TranslateSetup = typeof TRANSLATE_DEFAULTS & Pick<TranslateSwitches, 'prompt'> & { own: boolean };

export function translateSwitches(store: Pick<ObjectStore, 'get'>, character: string | null): TranslateSetup {
  const { switches: held, own } = scoped(store, character, 'translate');
  const switches = { ...TRANSLATE_DEFAULTS, ...held };
  return { ...switches, input: switches.input && !switches.reverse, own };
}

export const setTranslate = (store: ObjectStore, character: string | null, change: Partial<TranslateSwitches>) => setScoped(store, character, 'translate', change);

export const setOwnTranslate = (store: ObjectStore, character: string, own: boolean) => setOwnScoped(store, character, 'translate', own);

// Absent auto, spend, pov and comic are off; an absent ladder draws one picture. A chat reads them through 기능 (runtime/features chatIllustrate).
export type IllustrateSetup = Omit<IllustrateSwitches, 'auto' | 'spend' | 'ladder' | 'pov' | 'comic'> & { auto: boolean; spend: boolean; ladder: Rung[]; pov: boolean; comic: boolean; own: boolean };

export function illustrateSwitches(store: Pick<ObjectStore, 'get'>, character: string | null): IllustrateSetup {
  const { switches, own } = scoped(store, character, 'illustrate');
  return { ...switches, auto: switches?.auto ?? false, spend: switches?.spend ?? false, ladder: switches?.ladder ?? [], pov: switches?.pov ?? false, comic: switches?.comic ?? false, own };
}

export const setIllustrate = (store: ObjectStore, character: string | null, change: Partial<IllustrateSwitches>) => setScoped(store, character, 'illustrate', change);

export const setOwnIllustrate = (store: ObjectStore, character: string, own: boolean) => setOwnScoped(store, character, 'illustrate', own);

// Append global then character note. Trim only on read: autosave trimming would eat a newline still being typed.
export function translatorNotes(store: ObjectStore, character: string | null): string {
  const global = store.get('settings', SETTINGS_ID)?.value.translatorNote;
  const own = character === null ? undefined : store.get('character', character)?.value.translatorNote;
  return [global, own].map((note) => note?.trim() ?? '').filter(Boolean).join('\n\n');
}

// character null is the 전역 note, unlike setTranslate's null, which is 캐릭터 없이's switches. Blank removes the note.
export function setTranslatorNote(store: ObjectStore, character: string | null, text: string): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  const noted = <T extends { translatorNote?: string }>(current: T): T => (text.trim() ? { ...current, translatorNote: text } : without(current, 'translatorNote'));
  if (character === null) return store.upsert('settings', (current = EMPTY_SETTINGS) => noted(current));
  return store.update('character', character, noted);
}

export function setTextTranslation(store: ObjectStore, character: string, source: string, language: string, translation: Translation) {
  return store.update('character', character, (current) => {
    const held = readableTexts(current.card);
    return {
      ...current,
      translations: [...(current.translations ?? []).filter((each) => held.includes(each.source) && !(each.source === source && each.language === language)), { source, language, translation }],
    };
  });
}

export function resetToggles(store: ObjectStore, character: string | null): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current = EMPTY_SETTINGS) => without(current, 'toggles'));
  return store.update('character', character, (current) => without(current, 'toggles'));
}
