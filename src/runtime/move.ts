import { SIGNATURE } from '../engine/assets';
import { backupInlays, inlayType, readInlays, type Inlays } from '../engine/import/backup';
import { fileSource } from '../engine/import/source';
import { counted } from '../engine/import/convert';
import { inlayIds } from '../engine/assets';
import { mergeUnsupported, MOVE_UNSUPPORTED_KINDS, unsupportedCount, type BackupCatalog, type Card, type Imported, type MoveUnsupported, type RisuBackup, type RisuChat, type Unsupported } from '../engine/import/types';
import { unused, type Unused } from '../engine/pipeline';
import type { Chat } from '../model/chat';
import { filedIn } from '../model/folders';
import type { Asset } from '../model/library';
import type { MemorySettings } from '../model/memory';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { createFolder } from './folders';
import { importCharacter, orderFirst, saveAssets, setToggle, type ImportedCharacter, type Progress } from './characters';
import { setSharedLoreScan } from './chat-context';
import { chatWrites, saveNewChats } from './chat-log';
import type { Files } from './files';
import { projectGreetings, startingGreetings } from './greetings';
import { defaultMemory } from './memory-read';
import { importedLore } from './lore';
import { importModule, setModuleAlways } from './modules';
import { addRisuPersona, setCurrentPersona } from './personas';
import { savePreset } from './prompts';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';

export type MovePick = Pick<BackupCatalog, 'characters' | 'personas' | 'presets' | 'modules'>;
export type MoveStep = { kind: 'characters' | 'chats' | 'personas' | 'prompts' | 'modules' | 'pictures'; done: number; total: number };
// risu: its Risu chaId. unsupported: the parser's and the store's counts together (runtime/characters ImportedCharacter);
// faceless also when the picture did not read.
type MovedCharacter = { id: string; risu: string; name: string; chats: number; unsupported: Unsupported; faceless: boolean; missed: MoveUnsupported[]; unused: Unused[] };
type MovedModule = { name: string; unsupported: Unsupported };
// loreBudget: the 로어북 최대 분량 this move set from Risu's; null when it set none. toggles: how many of Risu's toggle
// values this move wrote anywhere, onto a character it brought or onto 캐릭터 없이.
export type Moved = { characters: MovedCharacter[]; personas: number; prompts: number; modules: MovedModule[]; loreBudget: number | null; toggles: number };

// Those in 휴지통 too, until they are removed for good.
export const broughtFromRisu = (store: ObjectStore): Set<string> => new Set(store.list('character').flatMap(({ value }) => (value.risu === undefined ? [] : [value.risu])));

// By Risu id, the deleted ones too, until they are removed for good.
export const modulesFromRisu = (store: ObjectStore): Map<string, string> => new Map(store.list('module').flatMap(({ id, value }) => (value.risu === undefined ? [] : [[value.risu, id]])));

// Import personas (after their modules) before chats; modules before dependent prompts/characters. Stop on first failure,
// retaining earlier saves. Write chat entries first, then roots with their character (addCharacter): interrupted entries
// stay unreachable, so retries can skip completed characters. Later inlays are recoverable through fillInlays.
// Write a module's 항상 reference before the module: interrupted dangling ids read as off and retry imports it again.
// Pin every write to the starting timeline; restore stops the move. Without the inlay export, count every inlay as not brought.
export function moveFromRisu(store: ObjectStore, files: Files, backup: RisuBackup, pick: MovePick, inlays: Inlays | null, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  return store.pinned(() => move(store, files, backup, pick, inlays, progress));
}

async function move(store: ObjectStore, files: Files, backup: RisuBackup, { characters, personas, presets, modules }: MovePick, inlays: Inlays | null, progress: (step: MoveStep) => void): Promise<ApiResult<Moved>> {
  // A kind's line counts what landed: 0 as its first begins, total once its last did, so it ends whole, not at total - 1.
  const landed = (kind: MoveStep['kind'], done: number, total: number) => progress({ kind, done, total });
  const personaIds = new Map<string, string>();
  const movedModules: MovedModule[] = [];
  // Only onto an account that has set none: one set here is the user's later choice.
  const loreBudget = store.get('settings', SETTINGS_ID)?.value.loreBudget === undefined ? backup.catalog.loreBudget : null;
  if (loreBudget !== null) {
    const set = await setSharedLoreScan(store, 'tokenBudget', loreBudget);
    if (!set.ok) return set;
  }
  // Risu kept one value per key for every chat, so every character this run brings takes them all. 캐릭터 없이 takes only
  // the keys it holds none for, as the budget above. Not filtered by what is declared: a key nothing declares yet reads
  // nothing until a prompt or pack declares it.
  const held = store.get('settings', SETTINGS_ID)?.value.toggles ?? {};
  const unset = Object.entries(backup.catalog.toggles).filter(([key]) => !Object.hasOwn(held, key));
  for (const [key, value] of unset) {
    const set = await setToggle(store, null, key, value);
    if (!set.ok) return set;
  }
  for (const [done, { key, selected }] of personas.entries()) {
    landed('personas', done, personas.length);
    const persona = await backup.persona(key);
    const picture = await persona.picture();
    const modules: string[] = [];
    // Drop the shared '$embedded' Risu id so personas' modules do not deduplicate. Read pictures before another
    // backup request releases them (runtime/import reader).
    if (persona.module) {
      const imported = await importModule(store, files, persona.module, () => {});
      if (!imported.ok) return imported;
      movedModules.push({ name: persona.module.name, unsupported: mergeUnsupported(persona.module.unsupported, imported.data.unsupported) });
      modules.push(imported.data.id);
    }
    const saved = await addRisuPersona(store, persona, picture, modules);
    if (!saved.ok) return saved;
    if (persona.id !== null) personaIds.set(persona.id, saved.data.id);
    // Risu's choice becomes the current one before the chats below read it: those it bound to no persona used it there.
    if (selected) {
      const set = await setCurrentPersona(store, saved.data.id);
      if (!set.ok) return set;
    }
  }
  if (personas.length) landed('personas', personas.length, personas.length);

  const moduleIds = modulesFromRisu(store);
  const dueModules = modules.filter(({ risu }) => risu === null || !moduleIds.has(risu));
  const brought = broughtFromRisu(store);
  const due = characters.filter(({ id }) => !brought.has(id)).sort((a, b) => a.lastTalk - b.lastTalk);
  const pictureTotal = [...dueModules, ...due].reduce((sum, { assetCount }) => sum + assetCount, 0) + (inlays ? due.reduce((sum, { inlayCount }) => sum + inlayCount, 0) : 0);
  let picturesDone = 0;
  const uploading: Progress = (step) => {
    if (step.kind === 'assets') progress({ kind: 'pictures', done: picturesDone + step.done, total: pictureTotal });
  };
  for (const [done, { key }] of dueModules.entries()) {
    landed('modules', done, dueModules.length);
    const module = await backup.module(key);
    const id = crypto.randomUUID();
    // Only one this run brings: one already here keeps the 항상 the user has since given it.
    if (module.risu !== null && backup.catalog.alwaysModules.includes(module.risu)) {
      const always = await setModuleAlways(store, id, true);
      if (!always.ok) return always;
    }
    const saved = await importModule(store, files, module, uploading, module.risu === null ? undefined : { id, risu: module.risu });
    if (!saved.ok) return saved;
    picturesDone += module.assets.length;
    movedModules.push({ name: module.name, unsupported: mergeUnsupported(module.unsupported, saved.data.unsupported) });
    if (module.risu !== null) moduleIds.set(module.risu, saved.data.id);
  }
  if (dueModules.length) landed('modules', dueModules.length, dueModules.length);

  let prompts = 0;
  for (const [done, { key }] of presets.entries()) {
    landed('prompts', done, presets.length);
    const { result } = await backup.preset(key);
    if (!result.ok) continue;
    const saved = await savePreset(store, result);
    if (!saved.ok) return saved;
    prompts++;
  }
  if (presets.length) landed('prompts', presets.length, presets.length);

  // Chats and characters are listed by the server's rev, the latest first, and a batch takes its revs in the order
  // written. So what was talked in last is written last, whatever order Risu kept it in (due).
  const chatTotal = due.reduce((sum, { chatCount }) => sum + chatCount, 0);
  const current = store.get('settings', SETTINGS_ID)?.value.persona;
  let chatsDone = 0;
  const moved: MovedCharacter[] = [];
  for (const [done, { key }] of due.entries()) {
    landed('characters', done, due.length);
    const character = await backup.character(key);
    const folder = character.folder === null ? null : await folderNamed(store, character.folder);
    if (folder && !folder.ok) return folder;
    const avatar = await character.avatar();
    const id = crypto.randomUUID();
    const memory = movedMemory(store);
    // A character's chats are held together from their entries, which go in one batch, to their summaries, which read
    // the published character and go in one request: the source holds the whole character already, so this holds no
    // more than it. Nothing is pulled: what the leases hold is what this device wrote.
    const sorted = [...character.chats].sort((a, b) => lastTalk(a) - lastTalk(b));
    const chats = sorted.map((chat) => chatOf(crypto.randomUUID(), id, character.card, chat, personaIds, current, memory));
    const last = new Set(chats.flatMap(({ entries }) => entries.at(-1)?.id ?? []));
    let staged = 0;
    let saved: ImportedCharacter | undefined;
    let inlaysMissed = 0;
    const failure = await saveNewChats(store, chats.map(({ root }) => root.id), chats.flatMap(({ entries }) => entries), {
      written: (write) => {
        if (last.has(write.id)) progress({ kind: 'chats', done: chatsDone + ++staged, total: chatTotal });
      },
      landed: async () => {
        chatsDone += chats.length;
        const imported = await importCharacter(store, files, character, avatar, uploading, { id, folder: folder?.data ?? null, risu: character.id, toggles: backup.catalog.toggles, chats: chats.map(({ root }) => root) }, character.modules.flatMap((risu) => moduleIds.get(risu) ?? []));
        if (!imported.ok) return imported;
        saved = imported.data;
        picturesDone += character.assets.length;
        // The chats are still held here, which their inlays, scoped to them, need.
        for (const [index, { inlays: ids }] of sorted.entries()) {
          if (!inlays) {
            inlaysMissed += ids.length;
            continue;
          }
          if (!ids.length) continue;
          const filled = await fillPictures(store, files, { kind: 'inlay', parent: chats[index]!.root.id }, inlays.assets(ids), uploading);
          if (!filled.ok) return filled;
          picturesDone += ids.length;
          inlaysMissed += unsupportedCount(filled.data.unsupported);
        }
        return null;
      },
    });
    if (failure) return failure;
    const { unsupported, faceless } = saved!;
    const missed = counted(MOVE_UNSUPPORTED_KINDS, new Map([...character.missed.map(({ kind, count }) => [kind, count] as const), ['inlay', inlaysMissed]]));
    moved.push({ id, risu: character.id, name: character.card.name, chats: character.chats.length, unsupported: mergeUnsupported(character.report.unsupported, unsupported), faceless, missed, unused: unused(character.card) });
  }
  if (due.length) landed('characters', due.length, due.length);
  // Risu's order comes along, ahead of what was here. A failed write leaves them first by name (model/order), which is no
  // reason to report the move failed.
  const brings = new Map(moved.map(({ risu, id }) => [risu, id]));
  if (moved.length) await orderFirst(store, characters.flatMap(({ id }) => brings.get(id) ?? []));
  return { ok: true, data: { characters: moved, personas: personas.length, prompts, modules: movedModules, loreBudget, toggles: moved.length > 0 ? Object.keys(backup.catalog.toggles).length : unset.length } };
}

const lastTalk = (chat: RisuChat) => chat.messages.at(-1)?.at ?? 0;

// Moved chats start with long-term memory off: on, opening a long one would summarize its whole past at once (user,
// 2026-10-01: 옮겨 온 대화는 꺼진 채로). Turning it on in the chat summarizes it then.
const movedMemory = (store: ObjectStore): MemorySettings => ({ ...defaultMemory(store), on: false });

async function folderNamed(store: ObjectStore, name: string): Promise<ApiResult<string>> {
  const held = store.list('folder').find(({ value }) => filedIn(value) === 'character' && value.parent === undefined && value.name === name);
  if (held) return { ok: true, data: held.id };
  const made = await createFolder(store, 'character', name, null);
  return made.ok ? { ok: true, data: made.data.id } : made;
}

// Chats Risu saved to a file of their own, to character. They start as moved chats do: memory off, the current persona.
export async function importRisuChats(store: ObjectStore, character: string | null, chats: RisuChat[]): Promise<ApiResult<string[]>> {
  const card = character === null ? null : (store.get('character', character)?.value.card ?? null);
  const current = store.get('settings', SETTINGS_ID)?.value.persona;
  const made = [...chats].sort((a, b) => lastTalk(a) - lastTalk(b)).map((chat) => chatOf(crypto.randomUUID(), character, card, chat, new Map(), current, movedMemory(store)));
  const failure = await saveNewChats(store, made.map(({ root }) => root.id), made.flatMap(({ entries, root }) => [...entries, root]));
  return failure ?? { ok: true, data: made.map(({ root }) => root.id) };
}

// A chat Risu bound to no persona, or to one not brought, holds the current persona, as a chat saved here would. Its
// lorebook goes before its messages, whose last write a move counts its progress by.
function chatOf(id: string, character: string | null, card: Card | null, { title, note, persona, greeting, variables, messages, lore, loreFolders }: RisuChat, personaIds: ReadonlyMap<string, string>, current: string | undefined, memory: MemorySettings): ReturnType<typeof chatWrites> {
  // The chat opens on the greeting Risu showed; a blank one shown leaves the chat without one, as Risu showed none.
  // One past the card's greetings opens on its last, as Risu shows it; projectGreetings would take the first.
  const greetings = card && startingGreetings(projectGreetings(card.greetings, card.greetings.map(() => crypto.randomUUID()), Math.min(greeting, Math.max(card.greetings.length - 1, 0))));
  const own = (persona === null ? undefined : personaIds.get(persona)) ?? current;
  const { folders, writes } = importedLore(id, lore, loreFolders);
  const chat: Chat = { title: title.trim() || null, character, models: {}, memory, ...(note !== null && { note }), ...(own && { persona: own }), ...(variables.length > 0 && { variables }), ...(folders.length > 0 && { loreFolders: folders }) };
  const { entries, root } = chatWrites(id, chat, greetings, messages);
  return { entries: [...writes, ...entries], root };
}

export const risuMatch = (store: ObjectStore, name: string): string | null =>
  store.list('character').find(({ value }) => value.risu !== undefined && value.deleted === undefined && value.card.name === name)?.id ?? null;

// A character's assets, or a chat's inlays (Risu's pictures inside its messages, by their Risu ids), which are scoped to
// the chat: the caller holds it, from before reading what it has to after the write.
type Holder = { kind: 'asset' | 'inlay'; parent: string };

// Only the names the holder does not have yet, so the same pictures given twice add nothing; unsupported as in
// runtime/characters ImportedCharacter, so a name it had is neither kept nor counted.
export async function fillPictures(store: ObjectStore, files: Files, { kind, parent }: Holder, assets: Imported['assets'], progress: Progress = () => {}, signal?: AbortSignal): Promise<ApiResult<{ kept: Asset[]; unsupported: Unsupported }>> {
  if (!store.get(kind === 'asset' ? 'character' : 'chat', parent)) return { ok: false, error: 'gone' };
  const had = new Set(store.children(kind, parent).map(({ value }) => value.name));
  const saved = await saveAssets(files, assets.filter(({ name }) => !had.has(name)), progress, kind === 'inlay' ? inlayType : undefined, signal);
  if (!saved.ok) return saved;
  const added = await store.batch(saved.data.kept.map((value): Write => ({ type: 'create', kind, id: crypto.randomUUID(), parent, value })), undefined, { unheld: kind === 'inlay', signal });
  return added.ok ? saved : added;
}

// The files dropped for a move apart: the backups, and the inlays from Risu web's inlay export, the first one dropped
// (engine/import readInlays), or else from a PocketRisu backup, which holds its own (backupInlays). Risu web keeps
// inlays in the browser, so they are the export's or none, never both.
export async function sortRisuFiles(dropped: File[]): Promise<{ backups: File[]; inlays: Inlays | null }> {
  const backups: File[] = [];
  let exported: Inlays | null = null;
  let held: Inlays | null = null;
  for (const file of dropped) {
    const source = fileSource(file);
    const read: Inlays | null = exported ? null : await readInlays(source);
    if (read) exported = read;
    else {
      backups.push(file);
      held ??= await backupInlays(source);
    }
  }
  return { backups, inlays: exported ?? held };
}

// chats: those gone through, of total; pictures: inlays added; missed: inlays named but not added (the export lacked
// them, they are video or audio, or the account's picture cap refused them); unread: chats whose history did not read.
export type FilledInlays = { chats: number; total: number; pictures: number; missed: number; unread: number };

// 메시지 이미지 채우기: fills every chat, 휴지통's too, with the inlays its messages name, one chat held at a time, so a
// pass over thousands holds one chat's history and one window of pictures. Run again, it adds nothing (fillPictures).
export function fillInlays(store: ObjectStore, files: Files, inlays: Inlays, progress: (step: FilledInlays) => void, signal: AbortSignal): Promise<ApiResult<FilledInlays>> {
  return store.pinned(async () => {
    const chats = store.list('chat').map(({ id }) => id);
    const filled: FilledInlays = { chats: 0, total: chats.length, pictures: 0, missed: 0, unread: 0 };
    for (const chat of chats) {
      progress({ ...filled });
      const result = await store.withChats([chat], async (readable): Promise<ApiResult<null>> => {
        if (!readable.length) {
          filled.unread++;
          return { ok: true, data: null };
        }
        const ids = inlayIds(store.children('entry', chat).flatMap(({ value }) => (value.type === 'message' || value.type === 'version' ? [value.text, value.reasoning ?? ''] : [])));
        if (!ids.length) return { ok: true, data: null };
        const saved = await fillPictures(store, files, { kind: 'inlay', parent: chat }, inlays.assets(ids), undefined, signal);
        if (!saved.ok) return saved;
        filled.pictures += saved.data.kept.filter(({ type }) => type !== SIGNATURE).length;
        filled.missed += unsupportedCount(saved.data.unsupported);
        return { ok: true, data: null };
      }, { signal, summarize: false });
      if (!result.ok) return result;
      filled.chats++;
    }
    progress({ ...filled });
    return { ok: true, data: filled };
  }, signal);
}
