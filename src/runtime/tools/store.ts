import { CLAIM_SETTLE_MS } from '../../contracts/files';
import type { Chat } from '../../model/chat';
import type { ToolUnit } from '../../model/tool';
import { packsOf } from '../chat-context';
import { assetType } from '../../engine/import/card';
import { fieldValue, type ImportedTool } from '../../engine/import/tool';
import { without } from '../../model/fields';
import { live } from '../../model/library';
import { toolId, type Badges, type Tool } from '../../model/tool';
import type { Json, Settings, ToolManifest } from '../../tool-api/manifest';
import type { ApiResult } from '../api';
import type { Files } from '../files';
import type { Session } from '../session';
import type { ObjectStore } from '../store';
import type { Write } from '../object-writes';

export type ToolImport = { id: string; previous: Tool | null };
// Bound inline tooldata/toolchat values by the maximum sealed BATCH_LIMITS.body.
export const TOOL_ROW_BYTES = 512 * 1024;
// Oversized values use toolfile: lazy reads avoid loading them at every account open.
// Their bytes count toward the picture budget.
export const TOOL_VALUE_BYTES = 4 * 1024 * 1024;
export const TOOL_DATA_BYTES = 32 * 1024 * 1024;
export const TOOL_CHAT_BYTES = 8 * 1024 * 1024;
export const TOOL_KEY_CHARS = 256;
const TOOL_WRITES_PER_MINUTE = 30;
export const TOOL_NOTICES_PER_MINUTE = 3;
const WRITE_PAUSE_MS = 1000;
// Past an upload's claim, so the sweep may release the file a write replaced.
const SWEEP_AFTER_MS = CLAIM_SETTLE_MS + 60_000;
const RATE_WINDOW_MS = 60_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const dataBytes = (key: string, value: Json) => encoder.encode(key).byteLength + encoder.encode(JSON.stringify(value)).byteLength;

export class ToolRate {
  private readonly sent = new Map<string, number[]>();
  constructor(private readonly limit: number) {}

  take(key: string): boolean {
    const recent = (this.sent.get(key) ?? []).filter((at) => Date.now() - at < RATE_WINDOW_MS);
    this.sent.set(key, recent);
    if (recent.length >= this.limit) return false;
    recent.push(Date.now());
    return true;
  }
}

function toolSettings(manifest: ToolManifest, values: Settings): Settings {
  const defaults = Object.fromEntries(manifest.settings.flatMap((field) => field.default === undefined ? [] : [[field.key, field.default]]));
  // Values survive a version that removes or changes a field; reverting code must not discard the user's settings.
  return { ...defaults, ...values };
}

// The tool of the same identity, which an import of this manifest replaces.
export const sameTool = (store: Pick<ObjectStore, 'list'>, { name, author }: ToolManifest) =>
  store.list('tool').find(({ value }) => value.manifest.name === name && value.manifest.author === author);

export async function importTool(store: ObjectStore, files: Files, { manifest, bytes }: ImportedTool): Promise<ApiResult<ToolImport>> {
  const existing = sameTool(store, manifest);
  // Reimport never revives a binned identity or leaves a second live copy beside it.
  if (existing && !live(store.get('module', existing.parent!))) return { ok: false, error: 'gone' };
  const uploaded = await files.save([bytes]);
  if (!uploaded.ok) return uploaded;
  const file = uploaded.data[0];
  if (!file) return { ok: false, error: 'tool-file-refused' };
  const id = existing?.parent ?? crypto.randomUUID();
  const previous = existing?.value ?? null;
  const value: Tool = { manifest, file, size: bytes.byteLength, settings: toolSettings(manifest, previous?.settings ?? {}) };
  if (existing) {
    // Reset new-use consent before exposing code; failed saves may re-ask but must never grant silently.
    // Re-ask only affected uses: adding memory must preserve model consent.
    const added = manifest.uses.filter((use) => !existing.value.manifest.uses.includes(use));
    const answers = [...(added.includes('model') || added.includes('embed') ? ['botModels' as const] : []), ...(added.includes('memory') ? ['takesMemory' as const] : []), ...(added.includes('network') ? ['network' as const] : [])];
    if (answers.length) {
      const reset = await store.update('module', id, (current) => current.deleted === undefined ? answers.reduce((module, answer) => without(module, answer), current) : null);
      if (!reset.ok) return reset;
    }
    const saved = await store.update('tool', existing.id, (current) => live(store.get('module', id)) ? { ...value, settings: toolSettings(manifest, current.settings) } : null);
    return saved.ok ? { ok: true, data: { id, previous } } : saved;
  }
  const saved = await store.batch([
    { type: 'create', kind: 'module', id, parent: null, value: { name: manifest.displayName, description: manifest.description, namespace: null, loreFolders: [], regex: [], triggers: [], toggles: [] } },
    { type: 'create', kind: 'tool', id: toolId(id), parent: id, value },
  ]);
  return saved.ok ? { ok: true, data: { id, previous: null } } : saved;
}

export const undoToolImport = (store: ObjectStore, module: string, previous: Tool) =>
  store.update('tool', toolId(module), (current) => live(store.get('module', module)) ? { ...previous, settings: toolSettings(previous.manifest, current.settings) } : null);

export async function setToolSettings({ store }: Pick<Session, 'store'>, module: string, change: Settings): Promise<ApiResult<unknown>> {
  return store.update('tool', toolId(module), (current) => live(store.get('module', module)) ? { ...current, settings: { ...current.settings, ...Object.fromEntries(current.manifest.settings.flatMap((field) => Object.hasOwn(change, field.key) && fieldValue(field, change[field.key]) ? [[field.key, change[field.key]!]] : [])) } } : null);
}

async function keyId(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Every device addresses the same key. The module separates equal key names owned by different tools; a chat's badge
// record has one part fewer, so no key a tool names reaches its id.
export const toolDataId = (module: string, key: string) => keyId(`${module}\0${key}`);
export const toolChatId = (module: string, chat: string, key: string | null) => keyId(key === null ? `${module}\0${chat}` : `${module}\0${chat}\0${key}`);

// The first part keeps it apart from every toolDataId and toolAssetId.
export const toolFileId = (module: string, key: string) => keyId(`file\0${module}\0${key}`);

const rowOf = (store: ObjectStore, module: string, key: string) => store.children('tooldata', module).find(({ value }) => value.key === key);
const fileOf = (store: ObjectStore, module: string, key: string) => store.children('toolfile', module).find(({ value }) => value.key === key);

export async function toolData({ store, files }: Pick<Session, 'store' | 'files'>, module: string, key: string): Promise<ApiResult<Json | undefined>> {
  const row = rowOf(store, module, key);
  if (row) return { ok: true, data: row.value.value };
  const held = fileOf(store, module, key);
  if (!held) return { ok: true, data: undefined };
  const read = await files.read(held.value.file);
  if (!read.ok) return read;
  try {
    return { ok: true, data: JSON.parse(decoder.decode(read.data)) as Json };
  } catch {
    return { ok: false, error: 'unreadable' };
  }
}
export const toolKeys = (store: ObjectStore, module: string): string[] =>
  [...store.children('tooldata', module), ...store.children('toolfile', module)].map(({ value }) => value.key);

export async function setToolData({ store, files }: Pick<Session, 'store' | 'files'>, module: string, key: string, value: Json): Promise<ApiResult<unknown>> {
  if (!live(store.get('module', module))) return { ok: false, error: 'gone' };
  if (key.length > TOOL_KEY_CHARS) return { ok: false, error: 'key-too-long' };
  const bytes = dataBytes(key, value);
  const others = store.children('tooldata', module).reduce((sum, row) => sum + (row.value.key === key ? 0 : dataBytes(row.value.key, row.value.value)), 0)
    + store.children('toolfile', module).reduce((sum, row) => sum + (row.value.key === key ? 0 : encoder.encode(row.value.key).byteLength + row.value.size), 0);
  if (bytes > TOOL_VALUE_BYTES || bytes + others > TOOL_DATA_BYTES) return { ok: false, error: 'too-large' };
  const writes: Write[] = [];
  if (bytes <= TOOL_ROW_BYTES) writes.push({ type: 'restore', kind: 'tooldata', id: await toolDataId(module, key), parent: module, value: { key, value } });
  else {
    const json = encoder.encode(JSON.stringify(value));
    const saved = await files.save([json]);
    if (!saved.ok) return saved;
    const [file] = saved.data;
    if (!file) return { ok: false, error: 'files-full' };
    writes.push({ type: 'restore', kind: 'toolfile', id: await toolFileId(module, key), parent: module, value: { key, size: json.byteLength, file } });
  }
  const other = bytes <= TOOL_ROW_BYTES ? fileOf(store, module, key) : rowOf(store, module, key);
  if (other) writes.push({ type: 'remove', id: other.id });
  return store.batch(writes);
}

export async function deleteToolData(store: ObjectStore, module: string, key: string): Promise<ApiResult<unknown>> {
  const held = [rowOf(store, module, key), fileOf(store, module, key)].flatMap((row) => row ? [{ type: 'remove' as const, id: row.id }] : []);
  return held.length ? store.batch(held) : { ok: true, data: null };
}

// Module-owned assets use module + content-hash ids, distinct from toolDataId.
// Repeated saves across devices reuse the same row/file without upload; removal follows the module.
export const toolAssetId = (module: string, name: string) => keyId(`asset\0${module}\0${name}`);

export async function saveToolAsset(store: ObjectStore, files: Files, module: string, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<string>> {
  if (!live(store.get('module', module))) return { ok: false, error: 'gone' };
  const type = assetType(bytes);
  if (!type) return { ok: false, error: 'unsupported-file' };
  const name = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const id = await toolAssetId(module, name);
  if (store.get('asset', id)) return { ok: true, data: name };
  const saved = await files.save([bytes]);
  if (!saved.ok) return saved;
  const [file] = saved.data;
  if (!file) return { ok: false, error: 'picture-refused' };
  // restore, as for toolchat: over a row the user deleted on the module page as well as where none was written.
  const written = await store.batch([{ type: 'restore', kind: 'asset', id, parent: module, value: { name, type, size: bytes.byteLength, file } }]);
  return written.ok ? { ok: true, data: name } : written;
}

// null: the module holds no picture by that name, another module's included.
export async function readToolAsset(store: ObjectStore, files: Files, module: string, name: string): Promise<ApiResult<Uint8Array<ArrayBuffer> | null>> {
  const asset = store.get('asset', await toolAssetId(module, name));
  return asset ? files.read(asset.value.file) : { ok: true, data: null };
}

const chatRows = (store: ObjectStore, module: string, chat: string) => store.children('toolchat', chat).filter(({ value }) => value.module === module);
export const toolChatData = (store: ObjectStore, module: string, chat: string, key: string): Json | undefined => chatRows(store, module, chat).find(({ value }) => value.key === key)?.value.value;
export const toolChatKeys = (store: ObjectStore, module: string, chat: string): string[] => chatRows(store, module, chat).flatMap(({ value }) => (value.key === null ? [] : [value.key]));
export const toolBadges = (store: ObjectStore, module: string, chat: string): Badges => (chatRows(store, module, chat).find(({ value }) => value.key === null)?.value.value ?? {}) as Badges;

// Save event chat data and badges in one batch/rate unit, not one write per key; null clears a badge.
export async function saveToolChat(store: ObjectStore, module: string, chat: string, data: [string, Json | undefined][], badges: { message: string; version: string; text: string | null }[]): Promise<ApiResult<null>> {
  if (!live(store.get('module', module))) return { ok: false, error: 'gone' };
  const existing = chatRows(store, module, chat);
  const stored = new Map(existing.map((row) => [row.value.key, row.id]));
  const rows = new Map(existing.map((row) => [row.value.key, row.value.value]));
  const changed = new Map<string | null, Json | undefined>(data);
  if (data.some(([key]) => key.length > TOOL_KEY_CHARS)) return { ok: false, error: 'key-too-long' };
  if (data.some(([key, value]) => value !== undefined && dataBytes(key, value) > TOOL_ROW_BYTES)) return { ok: false, error: 'too-large' };
  if (badges.length) {
    const held: Badges = { ...(rows.get(null) as Badges | undefined) };
    for (const { message, version, text } of badges) {
      if (text === null) delete held[message];
      else held[message] = { version, text };
    }
    changed.set(null, Object.keys(held).length ? held : undefined);
  }
  for (const [key, value] of changed) {
    if (value === undefined) rows.delete(key);
    else rows.set(key, value);
  }
  if ([...rows].reduce((sum, [key, value]) => sum + dataBytes(key ?? '', value), 0) > TOOL_CHAT_BYTES) return { ok: false, error: 'too-large' };
  const writes: Write[] = [];
  for (const [key, value] of changed) {
    const id = await toolChatId(module, chat, key);
    // restore writes over a held or deleted row alike, and creates one never written.
    if (value !== undefined) writes.push({ type: 'restore', kind: 'toolchat', id, parent: chat, value: { module, key, value } });
    else if (stored.has(key)) writes.push({ type: 'remove', id: stored.get(key)! });
  }
  return writes.length ? store.batch(writes) : { ok: true, data: null };
}

export const toolsOf = (store: ObjectStore, chat: Chat): ToolUnit[] => packsOf(store, chat).flatMap(({ id, module }) => {
  const tool = module && store.get('tool', toolId(id));
  return tool ? [{ module: id, tool: tool.value }] : [];
});

type PendingData = { value: Json | undefined; waiting: { resolve(): void; reject(error: Error): void }[] };
type DataQueue = { pending: Map<string, PendingData>; timer: ReturnType<typeof setTimeout> | null; running: boolean };

export class ToolStorage {
  private readonly queues = new Map<string, DataQueue>();
  // A file's value by its key, read once: a file is named by its sealed bytes, so a value written again names another.
  private readonly files = new Map<string, { id: string; read: Promise<ApiResult<Json | undefined>> }>();
  // Replaced files remain counted until a sweep after the claim window; rate-limit whole-account sweeps
  // and retry once for files too recent to release on the first pass.
  private sweep: { timer: ReturnType<typeof setTimeout>; again: boolean } | null = null;
  private closed = false;
  private readonly rate = new ToolRate(TOOL_WRITES_PER_MINUTE);

  take(module: string) {
    if (this.closed) throw new Error('closed');
    if (!this.rate.take(module)) throw new Error('too-many-writes');
  }
  constructor(private readonly session: Pick<Session, 'store' | 'files'>) {}

  async read(module: string, key: string): Promise<Json | undefined> {
    const slot = `${module}\0${key}`;
    const file = fileOf(this.session.store, module, key)?.value.file.id;
    if (file === undefined) this.files.delete(slot);
    else if (this.files.get(slot)?.id !== file) this.files.set(slot, { id: file, read: toolData(this.session, module, key) });
    const read = await (this.files.get(slot)?.read ?? toolData(this.session, module, key));
    if (read.ok) return read.data;
    if (this.files.get(slot)?.id === file) this.files.delete(slot);
    throw new Error(read.error);
  }

  async write(module: string, key: string, value: Json | undefined): Promise<void> {
    // The merge pause is part of the write's original timeline, not a new write after an account restore.
    const result = await this.session.store.pinned(() => this.enqueue(module, key, value));
    if (result && !result.ok) throw new Error(result.error);
  }

  private enqueue(module: string, key: string, value: Json | undefined): Promise<void> {
    if (this.closed) return Promise.reject(new Error('closed'));
    if (key.length > TOOL_KEY_CHARS) return Promise.reject(new Error('key-too-long'));
    if (value !== undefined && dataBytes(key, value) > TOOL_VALUE_BYTES) return Promise.reject(new Error('too-large'));
    const queue = this.queues.get(module) ?? { pending: new Map(), timer: null, running: false };
    this.queues.set(module, queue);
    const promise = new Promise<void>((resolve, reject) => {
      const pending = queue.pending.get(key);
      if (pending) { pending.value = value; pending.waiting.push({ resolve, reject }); }
      else queue.pending.set(key, { value, waiting: [{ resolve, reject }] });
    });
    this.schedule(module, queue);
    return promise;
  }

  cancel(module: string) {
    const queue = this.queues.get(module);
    if (!queue) return;
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = null;
    for (const pending of queue.pending.values()) for (const waiter of pending.waiting) waiter.reject(new Error('closed'));
    queue.pending.clear();
    // Rate history survives restarts and reimports of the same module.
  }

  close() {
    this.closed = true;
    if (this.sweep) clearTimeout(this.sweep.timer);
    this.sweep = null;
    for (const module of this.queues.keys()) this.cancel(module);
  }

  private sweepLater() {
    if (this.closed) return;
    if (this.sweep) { this.sweep.again = true; return; }
    const sweep = this.sweep = {
      again: false,
      timer: setTimeout(() => {
        this.sweep = null;
        void this.session.files.sweep();
        if (sweep.again) this.sweepLater();
      }, SWEEP_AFTER_MS),
    };
  }

  private schedule(module: string, queue: DataQueue) {
    if (this.closed || queue.timer || queue.running || !queue.pending.size) return;
    queue.timer = setTimeout(() => {
      queue.timer = null;
      void this.flush(module, queue);
    }, WRITE_PAUSE_MS);
  }

  private async flush(module: string, queue: DataQueue) {
    queue.running = true;
    const pending = [...queue.pending];
    queue.pending.clear();
    try {
      for (const [key, { value, waiting }] of pending) {
        try {
          if (this.closed) throw new Error('closed');
          this.take(module);
          const before = fileOf(this.session.store, module, key)?.value.file.id;
          const result = value === undefined ? await deleteToolData(this.session.store, module, key) : await setToolData(this.session, module, key, value);
          if (!result.ok) throw new Error(result.error);
          if (before !== undefined && fileOf(this.session.store, module, key)?.value.file.id !== before) this.sweepLater();
          for (const waiter of waiting) waiter.resolve();
        } catch (error) {
          for (const waiter of waiting) waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      queue.running = false;
      this.schedule(module, queue);
    }
  }
}
