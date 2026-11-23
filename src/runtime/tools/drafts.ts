import { readTool, splitTool, toolSource, type ImportedTool } from '../../engine/import/tool';
import type { ImportFailure } from '../../engine/import/types';
import type { Stored } from '../../model/kinds';
import { without } from '../../model/fields';
import { live } from '../../model/library';
import { toolId, type DraftAsk, type Tool, type ToolDraft, type ToolIdentity } from '../../model/tool';
import { TOOL_ROW_BYTES, type ToolManifest, type ToolUse } from '../../tool-api/manifest';
import type { ApiResult } from '../api';
import type { Files } from '../files/files';
import type { ObjectStore } from '../store/store';
import { importTool, sameTool, toolSettings, undoToolImport, type ToolImport } from './store';

export const DRAFT_BYTES: number = TOOL_ROW_BYTES;
const encoder = new TextEncoder();
export type DraftFile = Pick<ToolDraft, 'identity' | 'body'>;
const sourceOf = (draft: DraftFile) => toolSource(draft.identity, draft.body);
const fileOf = (manifest: ToolManifest, text: string): DraftFile => ({ identity: { name: manifest.name, author: manifest.author, displayName: manifest.displayName, version: manifest.version, description: manifest.description }, body: splitTool(text).body });
const tooLarge = (draft: DraftFile) => encoder.encode(sourceOf(draft)).byteLength > DRAFT_BYTES;

export const draftsOf = (store: Pick<ObjectStore, 'list'>): Stored<'tooldraft'>[] =>
  store.list('tooldraft').sort((a, b) => b.value.at - a.value.at);

export type DraftState = 'unapplied' | 'differs' | 'applied';
export const draftState = (draft: ToolDraft): DraftState => draft.applied === null ? 'unapplied' : sourceOf(draft) === draft.applied ? 'applied' : 'differs';

// name is the plugin's identity for updates, so it is made once here and never shown or changed.
export const draftIdentity = (author: string, named: Partial<Pick<ToolIdentity, 'displayName' | 'description'>>): ToolIdentity =>
  ({ name: `plugin-${crypto.randomUUID().slice(0, 8)}`, author, displayName: named.displayName ?? '', version: '0.1.0', description: named.description ?? '' });

export const blankDraft = (author: string): DraftFile => ({ identity: draftIdentity(author, { displayName: '내 플러그인' }), body: "hazelle.on('prompt', () => '');\n" });

export async function createDraft(store: ObjectStore, id: string, file: DraftFile): Promise<ApiResult<null>> {
  if (tooLarge(file)) return { ok: false, error: 'draft-too-large' };
  const saved = await store.create('tooldraft', { ...file, module: null, applied: null, asks: [], at: Date.now() }, { id, parent: null });
  return saved.ok ? { ok: true, data: null } : saved;
}

export async function saveDraft(store: ObjectStore, id: string, patch: Partial<DraftFile>): Promise<ApiResult<unknown>> {
  const current = store.get('tooldraft', id);
  if (!current) return { ok: false, error: 'gone' };
  if (tooLarge({ ...current.value, ...patch })) return { ok: false, error: 'draft-too-large' };
  return store.update('tooldraft', id, (draft) => ({ ...draft, ...patch, at: Date.now() }));
}

export async function addDraftAsk(store: ObjectStore, id: string, ask: DraftAsk, body: string | null): Promise<ApiResult<unknown>> {
  const current = store.get('tooldraft', id);
  if (!current) return { ok: false, error: 'gone' };
  if (body !== null && tooLarge({ ...current.value, body })) return { ok: false, error: 'draft-too-large' };
  return store.update('tooldraft', id, (draft) => ({ ...draft, asks: [...draft.asks, ask].slice(-30), ...(body !== null && { body }), at: Date.now() }));
}

export async function deleteDraft(store: ObjectStore, id: string): Promise<ApiResult<unknown>> {
  if (!store.get('tooldraft', id)) return { ok: false, error: 'gone' };
  return store.remove(id);
}

// 초안 삭제's 되돌리기: the draft as it was, under its own id.
export const restoreDraft = (store: ObjectStore, id: string, draft: ToolDraft) => store.batch([{ type: 'restore', kind: 'tooldraft', id, parent: null, value: draft }]);

// A plugin made for Hazelle, as installed: a Risu one opens in no draft and runs in no test (ruled 2026-10-29).
function ownTool(store: Pick<ObjectStore, 'get'>, module: string): ApiResult<Stored<'tool'>> {
  const tool = live(store.get('module', module)) && store.get('tool', toolId(module));
  if (!tool) return { ok: false, error: 'gone' };
  return tool.value.manifest.risu ? { ok: false, error: 'risu-plugin' } : { ok: true, data: tool };
}

// The installed file as a draft holds one, saved nowhere: what a draft is opened from, and what 테스트 runs of a
// plugin whose file is past a draft's size.
export async function installedFile(store: Pick<ObjectStore, 'get'>, files: Files, module: string): Promise<ApiResult<DraftFile>> {
  const tool = ownTool(store, module);
  if (!tool.ok) return tool;
  const read = await files.read(tool.data.value.file);
  return read.ok ? { ok: true, data: fileOf(tool.data.value.manifest, new TextDecoder().decode(read.data)) } : read;
}

export async function draftOfTool(store: ObjectStore, files: Files, module: string): Promise<ApiResult<string>> {
  const tool = ownTool(store, module);
  if (!tool.ok) return tool;
  const existing = draftsOf(store).find(({ value }) => value.module === module);
  if (existing) return { ok: true, data: existing.id };
  if (tool.data.value.size > DRAFT_BYTES) return { ok: false, error: 'draft-too-large' };
  const file = await installedFile(store, files, module);
  if (!file.ok) return file;
  if (tooLarge(file.data)) return { ok: false, error: 'draft-too-large' };
  const id = crypto.randomUUID();
  const saved = await store.create('tooldraft', { ...file.data, module, applied: sourceOf(file.data), asks: [], at: Date.now() }, { id, parent: null });
  return saved.ok ? { ok: true, data: id } : saved;
}

// carried: the draft as it was before the file replaced it, for the import's 되돌리기.
export type FileImport = ToolImport & { carried: Stored<'tooldraft'> | null };

// A file imported over a plugin carries the plugin's draft along. A draft with edits of its own, or one that could not
// hold the file, stays as it was, and installedDiffers tells 적용 so.
// The identity is a name the file states of itself, so what its module answered was answered to other code: every
// consent is asked again, and reset before this code is exposed. A draft applied is the user's own edit (applyDraft).
export async function importFile(store: ObjectStore, files: Files, tool: ImportedTool): Promise<ApiResult<FileImport>> {
  const module = sameTool(store, tool.manifest)?.parent;
  if (module && live(store.get('module', module))) {
    const reset = await store.update('module', module, (current) => (['botModels', 'takesMemory', 'network'] as const).reduce((value, answer) => without(value, answer), current));
    if (!reset.ok) return reset;
  }
  const installed = await importTool(store, files, tool);
  if (!installed.ok) return installed;
  const draft = draftsOf(store).find(({ value }) => value.module === installed.data.id);
  const file = fileOf(tool.manifest, new TextDecoder().decode(tool.bytes));
  if (!draft || draftState(draft.value) !== 'applied' || tooLarge(file)) return { ok: true, data: { ...installed.data, carried: null } };
  const saved = await store.update('tooldraft', draft.id, (current) => ({ ...current, ...file, applied: sourceOf(file), at: Date.now() }));
  return saved.ok ? { ok: true, data: { ...installed.data, carried: draft } } : saved;
}

export async function undoFileImport(store: ObjectStore, { id, carried }: FileImport, previous: Tool): Promise<ApiResult<unknown>> {
  const undone = await undoToolImport(store, id, previous);
  if (!undone.ok || !carried) return undone;
  const { identity, body, applied } = carried.value;
  return store.update('tooldraft', carried.id, (current) => draftState(current) === 'applied' ? { ...current, identity, body, applied } : null);
}

// Whether the installed file is no longer the one the draft last matched, so 적용 would replace code the draft never held.
// Through the manifest on both sides: an imported file's header need not be written as toolSource writes it.
export async function installedDiffers(store: Pick<ObjectStore, 'get'>, files: Files, draft: ToolDraft): Promise<boolean> {
  const tool = draft.module && store.get('tool', toolId(draft.module));
  if (!tool || draft.applied === null) return false;
  const read = await files.read(tool.value.file);
  return read.ok && canonical(new TextDecoder().decode(read.data)) !== canonical(draft.applied);
}

function canonical(text: string): string {
  const read = readTool(encoder.encode(text));
  return read.ok ? sourceOf(fileOf(read.tool.manifest, text)) : text;
}

const nextVersion = (version: string) => {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return parts ? `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}` : null;
};

// 적용 raises the patch version when the installed plugin already has the draft's version and the file changed since
// it was last applied; a version the user set, or one that is not x.y.z, is applied as it is.
type Prepared = { ok: true; file: DraftFile; tool: ImportedTool; previous: Stored<'tool'> | null } | { ok: false; failure: ImportFailure };
function prepare(store: Pick<ObjectStore, 'list' | 'get'>, draft: ToolDraft): Prepared {
  const read = readTool(encoder.encode(sourceOf(draft)));
  if (!read.ok) return read;
  const previous = sameTool(store, read.tool.manifest) ?? null;
  const raised = previous && previous.value.manifest.version === draft.identity.version && sourceOf(draft) !== draft.applied ? nextVersion(draft.identity.version) : null;
  if (!raised) return { ok: true, file: draft, tool: read.tool, previous };
  const file = { identity: { ...draft.identity, version: raised }, body: draft.body };
  const again = readTool(encoder.encode(sourceOf(file)));
  return again.ok ? { ok: true, file, tool: again.tool, previous } : again;
}

export type ApplyPreview = { ok: true; manifest: ToolManifest; previous: { module: string; manifest: ToolManifest } | null; added: ToolUse[] } | { ok: false; failure: ImportFailure };
export function applyPreview(store: Pick<ObjectStore, 'list' | 'get'>, draft: ToolDraft): ApplyPreview {
  const prepared = prepare(store, draft);
  if (!prepared.ok) return prepared;
  const { tool: { manifest }, previous } = prepared;
  return { ok: true, manifest, previous: previous ? { module: previous.parent!, manifest: previous.value.manifest } : null, added: manifest.uses.filter((use) => !previous?.value.manifest.uses.includes(use)) };
}

// A draft as a test runs it: the file 적용 would install, on the settings and over the stored data of the installed
// plugin it would replace (module), else the defaults and nothing stored. line in a run's failure is the file's;
// bodyLine maps it into the editor's body.
export type DraftTrial = { tool: Pick<Tool, 'manifest' | 'settings'>; module: string | null; code: string };
export function draftTrial(store: Pick<ObjectStore, 'list'>, draft: DraftFile): { ok: true; trial: DraftTrial } | { ok: false; failure: ImportFailure } {
  const code = sourceOf(draft);
  const read = readTool(encoder.encode(code));
  if (!read.ok) return read;
  const { manifest } = read.tool;
  const installed = sameTool(store, manifest);
  return { ok: true, trial: { code, module: installed?.parent ?? null, tool: { manifest, settings: toolSettings(manifest, installed?.value.settings ?? {}) } } };
}
export const bodyLine = (draft: DraftFile, line: number) => line - (sourceOf(draft).split('\n').length - draft.body.split('\n').length);

export async function applyDraft(store: ObjectStore, files: Files, id: string): Promise<ApiResult<ToolImport>> {
  const draft = store.get('tooldraft', id);
  if (!draft) return { ok: false, error: 'gone' };
  if (tooLarge(draft.value)) return { ok: false, error: 'draft-too-large' };
  const prepared = prepare(store, draft.value);
  if (!prepared.ok) return { ok: false, error: prepared.failure.detail ?? prepared.failure.kind };
  const installed = await importTool(store, files, prepared.tool);
  if (!installed.ok) return installed;
  const { identity } = prepared.file;
  const saved = await store.update('tooldraft', id, (current) => ({ ...current, identity, module: installed.data.id, applied: sourceOf(prepared.file) }));
  return saved.ok ? installed : saved;
}
