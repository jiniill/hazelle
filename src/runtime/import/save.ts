import type { PresetRead } from '../../engine/import/preset';
import type { ImportedTool } from '../../engine/import/tool';
import type { Imported, ImportedModule, ImportedPersona, Unsupported } from '../../engine/import/types';
import { live } from '../../model/library';
import type { Stored } from '../../model/kinds';
import { allWritten, type ApiResult } from '../api';
import { importCardFile } from '../export/card-file';
import { setDeleted, type ImportedCharacter, type Progress } from '../library/characters';
import type { Files } from '../files/files';
import { importModule, pairWithPrompts, replaceModules, sameNamespace, setModuleAt, setModuleDeleted, type ModulePlace } from '../library/modules';
import { keepOriginal, type OriginalFile } from './originals';
import { addRisuPersona, removePersona } from '../library/personas';
import { ofSort, removePrompt, savePreset, type StoredPrompt } from '../library/prompts';
import type { ObjectStore } from '../store/store';
import { importFile, undoFileImport, type FileImport } from '../tools/drafts';
import { ImportReadError, type ChatsRead } from './protocol';

type Sink = { store: ObjectStore; files: Files };
// 되돌리기 for what one file brought: it goes to 휴지통. Its closure holds ids, never the parsed file, which would stay
// alive with it.
export type Undo = () => Promise<ApiResult<unknown>>;
// The file it came from, kept beside what it made (runtime/import/originals); null where the file would not read again. The
// import stands either way.
export type Kept = ApiResult<{ unkept: number }> | null;
// Asked after what it made is saved.
type Original = () => Promise<OriginalFile>;

async function keep({ store, files }: Sink, id: string, original: Original, progress: Progress): Promise<Kept> {
  try {
    return await keepOriginal(store, files, id, await original(), progress);
  } catch (error) {
    if (!(error instanceof ImportReadError)) throw error;
    return null;
  }
}

// What the page an import starts from shows, where a module brought in is turned on first (design §6.5).
export type ImportPage = { kind: 'character' | 'chat' | 'prompt' | 'persona'; id: string } | { kind: 'always' };

// A chat's character, a conversation prompt and a live persona take it; nothing else on their pages does.
export function placeOn(store: ObjectStore, page: ImportPage): ModulePlace | null {
  switch (page.kind) {
    case 'always':
      return page;
    case 'character':
      return { kind: 'character', id: page.id };
    case 'chat': {
      const character = store.get('chat', page.id)?.value.character ?? null;
      return character === null ? null : { kind: 'character', id: character };
    }
    case 'prompt': {
      const prompt = live(store.get('prompt', page.id));
      return prompt && ofSort(prompt, 'conversation') ? { kind: 'prompt', prompt } : null;
    }
    case 'persona':
      return live(store.get('persona', page.id)) ? { kind: 'persona', id: page.id } : null;
  }
}

// Where a file of chats goes. picked: a character's id, null for 캐릭터 없이. asked: the user picks, picked first;
// name: the character the file names, which is not here.
export type Destination = { asked: boolean; name: string | null; picked: string | null };

// Where the way in named (target: a character's id, null for 캐릭터 없이), else to the character it was with when that one
// is here, else, when it names none, to the place's character. Otherwise the user picks, one of the file's name first.
export function chatDestination(store: ObjectStore, chats: ChatsRead, target: string | null | undefined, place: ModulePlace | null): Destination {
  const named = 'chat' in chats ? chats.chat.character : null;
  const placed = place?.kind === 'character' && live(store.get('character', place.id)) ? place.id : null;
  const fixed = (picked: string | null): Destination => ({ asked: false, name: null, picked });
  if (target !== undefined) return fixed(target);
  if (named === null) return placed === null ? { asked: true, name: null, picked: null } : fixed(placed);
  if (live(store.get('character', named.id))) return fixed(named.id);
  const same = store.list('character').find((character) => live(character) && character.value.card.name === named.name)?.id;
  return { asked: true, name: named.name, picked: same ?? placed };
}

export async function saveCharacter(sink: Sink, card: Imported, original: Original, progress: Progress): Promise<ApiResult<{ saved: ImportedCharacter; kept: Kept; undo: Undo }>> {
  const { store, files } = sink;
  const saved = await importCardFile(store, files, card, progress);
  if (!saved.ok) return saved;
  const { id } = saved.data;
  return { ok: true, data: { saved: saved.data, kept: await keep(sink, id, original, progress), undo: () => setDeleted(store, id, Date.now()) } };
}

// placed: turning it on at place, null with no place. replaced: the live versions of its namespace it took the place of,
// when asked to, and in how many places they were on. paired: the prompts whose preset named it, turned on there.
type SavedModule = {
  id: string;
  unsupported: Unsupported;
  placed: ApiResult<unknown> | null;
  replaced: { olds: Stored<'module'>[]; places: ApiResult<number> } | null;
  paired: ApiResult<StoredPrompt<'conversation'>[]>;
  kept: Kept;
  undo: Undo;
};

// Undone, the versions it replaced come back.
export async function saveModule(sink: Sink, module: ImportedModule, replace: boolean, place: ModulePlace | null, original: Original, progress: Progress): Promise<ApiResult<SavedModule>> {
  const { store, files } = sink;
  const olds = replace && module.namespace !== null ? sameNamespace(store, module.namespace) : [];
  const saved = await importModule(store, files, module, progress);
  if (!saved.ok) return saved;
  const { id, unsupported } = saved.data;
  const undo = () => allWritten([setModuleDeleted(store, id, Date.now()), ...olds.map((old) => setModuleDeleted(store, old.id, null))]);
  const placed = place && (await setModuleAt(store, place, id, true));
  // After the placement, which appends: replacing puts it where the older version was in that list too.
  const replaced = olds.length > 0 ? { olds, places: await replaceModules(store, id, olds.map((old) => old.id)) } : null;
  const paired = await pairWithPrompts(store, id, module);
  return { ok: true, data: { id, unsupported, placed, replaced, paired, kept: await keep(sink, id, original, progress), undo } };
}

// A tool new here is turned on at place and offers no 되돌리기: importTool would refuse its identity again while the
// binned one is kept. One over a version already here stays where that one was, and undoing brings that one back.
export async function saveTool(sink: Sink, tool: ImportedTool, place: ModulePlace | null): Promise<ApiResult<{ saved: FileImport; placed: ApiResult<unknown> | null; undo: Undo | null }>> {
  const { store, files } = sink;
  const saved = await importFile(store, files, tool);
  if (!saved.ok) return saved;
  const { previous } = saved.data;
  if (previous) return { ok: true, data: { saved: saved.data, placed: null, undo: () => undoFileImport(store, saved.data, previous) } };
  const placed = place && (await setModuleAt(store, place, saved.data.id, true));
  return { ok: true, data: { saved: saved.data, placed, undo: null } };
}

// Undone, the regex module its preset made goes too.
export async function savePrompt(sink: Sink, preset: PresetRead, original: Original, progress: Progress): Promise<ApiResult<{ id: string; paired: string[]; waiting: string[]; kept: Kept; undo: Undo }>> {
  const { store } = sink;
  const saved = await savePreset(store, preset);
  if (!saved.ok) return saved;
  const { id, paired, waiting, made } = saved.data;
  const undo = () => allWritten([removePrompt(store, id), ...(made === null ? [] : [setModuleDeleted(store, made, Date.now())])]);
  return { ok: true, data: { id, paired, waiting, kept: await keep(sink, id, original, progress), undo } };
}

export async function savePersona(store: ObjectStore, persona: ImportedPersona): Promise<ApiResult<{ saved: Stored<'persona'>; undo: Undo }>> {
  const saved = await addRisuPersona(store, persona, await persona.picture());
  if (!saved.ok) return saved;
  const { id } = saved.data;
  return { ok: true, data: { saved: saved.data, undo: () => removePersona(store, id) } };
}
