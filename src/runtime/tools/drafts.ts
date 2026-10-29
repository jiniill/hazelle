import { readTool } from '../../engine/import/tool';
import type { ImportFailure } from '../../engine/import/types';
import type { Stored } from '../../model/kinds';
import { live } from '../../model/library';
import { toolId, type DraftAsk, type ToolDraft } from '../../model/tool';
import type { ToolManifest, ToolUse } from '../../tool-api/manifest';
import type { ApiResult } from '../api';
import type { Files } from '../files';
import type { ObjectStore } from '../store';
import { importTool, sameTool, TOOL_ROW_BYTES, type ToolImport } from './store';

export const DRAFT_BYTES: number = TOOL_ROW_BYTES;
const encoder = new TextEncoder();
const tooLarge = (text: string) => encoder.encode(text).byteLength > DRAFT_BYTES;

export const draftsOf = (store: Pick<ObjectStore, 'list'>): Stored<'tooldraft'>[] =>
  store.list('tooldraft').sort((a, b) => b.value.at - a.value.at);

export type DraftState = 'unapplied' | 'differs' | 'applied';
export const draftState = (draft: ToolDraft): DraftState => draft.applied === null ? 'unapplied' : draft.text === draft.applied ? 'applied' : 'differs';

export async function createDraft(store: ObjectStore, text: string, id: string): Promise<ApiResult<null>> {
  if (tooLarge(text)) return { ok: false, error: 'draft-too-large' };
  const saved = await store.create('tooldraft', { text, module: null, applied: null, asks: [], at: Date.now() }, { id, parent: null });
  return saved.ok ? { ok: true, data: null } : saved;
}

export async function saveDraftText(store: ObjectStore, id: string, text: string): Promise<ApiResult<unknown>> {
  if (tooLarge(text)) return { ok: false, error: 'draft-too-large' };
  return store.update('tooldraft', id, (current) => ({ ...current, text, at: Date.now() }));
}

export async function addDraftAsk(store: ObjectStore, id: string, ask: DraftAsk, text: string | null): Promise<ApiResult<unknown>> {
  if (text !== null && tooLarge(text)) return { ok: false, error: 'draft-too-large' };
  return store.update('tooldraft', id, (current) => ({ ...current, asks: [...current.asks, ask].slice(-30), ...(text !== null && { text }), at: Date.now() }));
}

export async function deleteDraft(store: ObjectStore, id: string): Promise<ApiResult<unknown>> {
  if (!store.get('tooldraft', id)) return { ok: false, error: 'gone' };
  return store.remove(id);
}

// 초안 삭제's 되돌리기: the draft as it was, under its own id.
export async function restoreDraft(store: ObjectStore, id: string, draft: ToolDraft): Promise<ApiResult<null>> {
  const saved = await store.create('tooldraft', draft, { id, parent: null });
  return saved.ok ? { ok: true, data: null } : saved;
}

export async function draftOfTool(store: ObjectStore, files: Files, module: string): Promise<ApiResult<string>> {
  const tool = live(store.get('module', module)) && store.get('tool', toolId(module));
  if (!tool) return { ok: false, error: 'gone' };
  if (tool.value.manifest.risu) return { ok: false, error: 'risu-plugin' };
  const existing = draftsOf(store).find(({ value }) => value.module === module);
  if (existing) return { ok: true, data: existing.id };
  if (tool.value.size > DRAFT_BYTES) return { ok: false, error: 'draft-too-large' };
  const read = await files.read(tool.value.file);
  if (!read.ok) return read;
  if (read.data.byteLength > DRAFT_BYTES) return { ok: false, error: 'draft-too-large' };
  const text = new TextDecoder().decode(read.data);
  const id = crypto.randomUUID();
  const saved = await store.create('tooldraft', { text, module, applied: text, asks: [], at: Date.now() }, { id, parent: null });
  return saved.ok ? { ok: true, data: id } : saved;
}

export type ApplyPreview = { ok: true; manifest: ToolManifest; previous: { module: string; manifest: ToolManifest } | null; added: ToolUse[] } | { ok: false; failure: ImportFailure };
export function applyPreview(store: Pick<ObjectStore, 'list' | 'get'>, text: string): ApplyPreview {
  const read = readTool(encoder.encode(text));
  if (!read.ok) return read;
  const { manifest } = read.tool;
  const previous = sameTool(store, manifest);
  return { ok: true, manifest, previous: previous ? { module: previous.parent!, manifest: previous.value.manifest } : null, added: manifest.uses.filter((use) => !previous?.value.manifest.uses.includes(use)) };
}

export async function applyDraft(store: ObjectStore, files: Files, id: string): Promise<ApiResult<ToolImport>> {
  const draft = store.get('tooldraft', id);
  if (!draft) return { ok: false, error: 'gone' };
  const { text } = draft.value;
  if (tooLarge(text)) return { ok: false, error: 'draft-too-large' };
  const read = readTool(encoder.encode(text));
  if (!read.ok) return { ok: false, error: read.failure.detail ?? read.failure.kind };
  const installed = await importTool(store, files, read.tool);
  if (!installed.ok) return installed;
  const saved = await store.update('tooldraft', id, (current) => ({ ...current, module: installed.data.id, applied: text }));
  return saved.ok ? installed : saved;
}

export function blankPlugin(author: string): string {
  return `//@api 1
//@name my-plugin
//@author ${author}
//@display-name 내 플러그인
//@version 0.1.0

hazelle.on('prompt', () => '');
`;
}
