import { writeCharx } from '../engine/import/card';
import { moduleSource } from '../engine/import/hazelle';
import { risumBlock, risumHead, RISUM_END } from '../engine/import/risum';
import { type Bot, type Imported, type LoreEntry, mergeUnsupported, type Profiles, type TypedModule, type Unsupported } from '../engine/import/types';
import { zipWriter } from '../engine/import/zip';
import { live, type LoreFolder, type Module } from '../model/library';
import { likenessId } from '../model/likeness';
import type { ApiResult } from './api';
import type { BackupOutput } from './backup-zip';
import { importCharacter, type ImportedCharacter, type Progress } from './characters';
import { inOrder, type Files } from './files';
import { importModule } from './modules';
import type { ObjectStore } from './store';
import type { FileRef } from '../vault/files';

export type ExportStep = { done: number; total: number };

// A 삽화 profile's receipt is the exporting account's usage, which another account's 사용량 must not count.
const profilesOf = (store: ObjectStore, owner: string): Profiles | null => {
  const likeness = store.get('likeness', likenessId(owner))?.value;
  return likeness ? { portraits: likeness.portraits, at: likeness.at } : null;
};

// A lorebook as a file holds it: each entry's folder by its place among the folders.
export function lorebookOf(store: ObjectStore, owner: string, folders: LoreFolder[]): { lore: LoreEntry[]; loreFolders: string[] } {
  const ids = folders.map(({ id }) => id);
  return {
    lore: store.children('lore', owner).map(({ value }) => ({ ...value, folder: value.folder === null || !ids.includes(value.folder) ? null : ids.indexOf(value.folder) })),
    loreFolders: folders.map(({ name }) => name),
  };
}

function owned(store: ObjectStore, owner: string, folders: LoreFolder[]) {
  const pictures = store.children('asset', owner).map(({ value }) => value);
  return {
    ...lorebookOf(store, owner, folders),
    assets: pictures.map(({ name, type, use }) => ({ name, type, ...(use && { use }) })),
    files: pictures.map(({ file }) => file),
    likeness: profilesOf(store, owner),
  };
}

const moduleOf = (store: ObjectStore, id: string, { risu, name, description, namespace, loreFolders, regex, triggers, background, toggles }: Module): TypedModule & { files: FileRef[] } => ({
  risu: risu ?? id,
  name,
  description,
  namespace,
  pack: { regex, triggers, ...(background !== undefined && { background }), toggles },
  ...owned(store, id, loreFolders),
});

// What a charx holds: card.json and module.risum, and each picture's path in it with the stored file it is read from.
// The one writer of a character as a file: 내보내기 writes it out, and a share link seals it as its manifest
// (runtime/share), from which 파일로 받기 writes the same file again.
export type CharxContent = { entries: { path: string; bytes: Uint8Array<ArrayBuffer> }[]; pictures: { path: string; ref: FileRef }[] };

// A character as a CCv3 charx that Risu and this app both read (engine/import/card writeCharx), with the modules on
// for it in the module list. A module holding a tool is left out, as Risu cannot run it, and counted. Its chats, its
// persona, connections, settings, and what only tells this account's copy apart (별명, folder, its Risu id, the answers
// it was given, its own switches, its share link) stay.
export function charxContent(store: ObjectStore, id: string): ApiResult<CharxContent & { tools: number }> {
  const character = live(store.get('character', id))?.value;
  if (!character) return { ok: false, error: 'gone' };
  const own = owned(store, id, character.loreFolders);
  let tools = 0;
  const modules = (character.modules ?? []).flatMap((module) => {
    const stored = live(store.get('module', module));
    if (!stored) return [];
    if (store.children('tool', module).length > 0) {
      tools++;
      return [];
    }
    return [moduleOf(store, module, stored.value)];
  });
  const avatar = store.children('avatar', id)[0]?.value ?? null;
  const { translatorNote, keepThoughts, statusScripts, translations } = character;
  const bot: Bot = {
    card: character.card,
    lore: own.lore,
    loreFolders: own.loreFolders,
    avatar: avatar?.type ?? null,
    assets: own.assets,
    own: { character: { translatorNote, keepThoughts, statusScripts, translations }, likeness: own.likeness },
    bundled: modules,
  };
  const refs: FileRef[] = [...(avatar ? [avatar.file] : []), ...own.files, ...modules.flatMap((module) => module.files)];
  const { files: entries, pictures } = writeCharx(bot);
  return { ok: true, data: { entries, pictures: pictures.map((path, index) => ({ path, ref: refs[index]! })), tools } };
}

type Read = (ref: FileRef) => Promise<ApiResult<Uint8Array<ArrayBuffer>>>;

// The file written whole and closed, or aborted. The pictures are read ahead (runtime/files inOrder) and handed to put in
// order; one that cannot be read stops it, as the file already names it.
async function writeFile(
  output: BackupOutput,
  pictures: FileRef[],
  read: Read,
  progress: (step: ExportStep) => void,
  parts: { head: () => Promise<void>; put: (bytes: Uint8Array<ArrayBuffer>, index: number) => Promise<void>; end: () => Promise<void> },
): Promise<ApiResult<null>> {
  let complete = false;
  try {
    await parts.head();
    let index = 0;
    for await (const [, bytes] of inOrder(pictures, read)) {
      progress({ done: index, total: pictures.length });
      if (!bytes.ok) return bytes;
      await parts.put(bytes.data, index++);
    }
    progress({ done: index, total: pictures.length });
    await parts.end();
    await output.close();
    complete = true;
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: 'export-write' };
  } finally {
    if (!complete) await output.abort();
  }
}

export function writeCharxFile({ entries, pictures }: CharxContent, read: Read, output: BackupOutput, progress: (step: ExportStep) => void): Promise<ApiResult<null>> {
  const zip = zipWriter((bytes) => output.write(bytes));
  return writeFile(output, pictures.map(({ ref }) => ref), read, progress, {
    head: async () => {
      for (const { path, bytes } of entries) await zip.add(path, bytes, true);
    },
    // Pictures are compressed already.
    put: (bytes, index) => zip.add(pictures[index]!.path, bytes),
    end: () => zip.end(),
  });
}

// 내보내기 of a module: a .risum that Risu and this app both read (engine/import/hazelle moduleSource), its pictures as
// stored, never recompressed. A tool it holds stays here, as Risu cannot run it, and is counted.
export async function exportModule(store: ObjectStore, files: Files, id: string, output: BackupOutput, progress: (step: ExportStep) => void): Promise<ApiResult<{ tools: number }>> {
  const stored = live(store.get('module', id));
  if (!stored) return { ok: false, error: 'gone' };
  const { files: pictures, ...module } = moduleOf(store, id, stored.value);
  const written = await writeFile(output, pictures, (ref) => files.read(ref, { bulk: true }), progress, {
    head: () => output.write(risumHead(moduleSource(module))),
    put: (bytes) => output.write(risumBlock(bytes)),
    end: () => output.write(RISUM_END),
  });
  return written.ok ? { ok: true, data: { tools: store.children('tool', id).length } } : written;
}

// 내보내기.
export async function exportCharacter(store: ObjectStore, files: Files, id: string, output: BackupOutput, progress: (step: ExportStep) => void): Promise<ApiResult<{ tools: number }>> {
  const content = charxContent(store, id);
  if (!content.ok) return content;
  const written = await writeCharxFile(content.data, (ref) => files.read(ref, { bulk: true }), output, progress);
  return written.ok ? { ok: true, data: { tools: content.data.tools } } : written;
}

// A card file's character, after the modules it bundles: one already here and not deleted, by the id module files name
// it by (as a move finds Risu's), is turned on rather than brought again, so bots that share a module share one.
export async function importCardFile(store: ObjectStore, files: Files, imported: Imported, progress: Progress): Promise<ApiResult<ImportedCharacter>> {
  const here = new Map(store.list('module').flatMap(({ id, value }) => (value.deleted === undefined && value.risu !== undefined ? [[value.risu, id]] : [])));
  const on: string[] = [];
  const unsupported: Unsupported[] = [];
  for (const module of imported.bundled) {
    const found = module.risu === null ? undefined : (here.get(module.risu) ?? live(store.get('module', module.risu))?.id);
    if (found !== undefined) {
      on.push(found);
      continue;
    }
    const saved = await importModule(store, files, module, progress, module.risu === null ? undefined : { id: crypto.randomUUID(), risu: module.risu });
    if (!saved.ok) return saved;
    on.push(saved.data.id);
    unsupported.push(saved.data.unsupported);
  }
  const saved = await importCharacter(store, files, imported, imported.avatar, progress, undefined, on);
  return saved.ok ? { ok: true, data: { ...saved.data, unsupported: mergeUnsupported(saved.data.unsupported, ...unsupported) } } : saved;
}
