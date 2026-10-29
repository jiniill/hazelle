import { isRecord } from '../../connectors/values';
import type { Settings, ToolField, ToolManifest, ToolUse } from '../../tool-api/manifest';
import type { ToolIdentity } from '../../model/tool';
import type { ImportFailure } from './types';

export const TOOL_FILE_BYTES = 8 * 1024 * 1024;
// What a tool may draw in the chat, which the app draws for it (design §6.10, phase 2 D5).
export const TOOL_ACTIONS = 3;
export const TOOL_ACTION_CHARS = 16;
export const TOOL_COMPOSER_CHARS = 8;
export const USES: readonly ToolUse[] = ['model', 'embed', 'memory', 'network'];
export type ImportedTool = { manifest: ToolManifest; bytes: Uint8Array<ArrayBuffer> };
export type ToolRead = { ok: true; tool: ImportedTool } | { ok: false; failure: ImportFailure };
const HEADER_KEYS = new Set(['api', 'name', 'author', 'display-name', 'version', 'description', 'page']);
export const identity = (value: string) => /^[\p{L}\p{N}_.-]+$/u.test(value);
// written: the line as the file has it, quoted back in a failure.
export type HeaderLine = { key: string; value: string; written: string };
// header: the leading //@ lines, blank lines between them skipped; body: the code after them.
export type ToolText = { ok: true; header: HeaderLine[]; body: string } | { ok: false; failure: ImportFailure };
export const failed = (detail: string, line?: string): { ok: false; failure: ImportFailure } => ({ ok: false, failure: { kind: 'unreadable', detail, ...(line && { line }) } });

export function fieldValue(field: ToolField, value: unknown): value is Settings[string] {
  switch (field.type) {
    case 'text': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'switch': return typeof value === 'boolean';
    case 'choice': return typeof value === 'string' && !!field.options?.includes(value);
  }
}

function fieldOf(value: unknown): ToolField | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !identity(value.key) || typeof value.label !== 'string' || !value.label.trim()) return null;
  if (value.type !== 'text' && value.type !== 'number' && value.type !== 'switch' && value.type !== 'choice') return null;
  if (value.type === 'choice' && (!Array.isArray(value.options) || value.options.length === 0 || !value.options.every((option) => typeof option === 'string'))) return null;
  if (value.composer !== undefined && value.composer !== true) return null;
  const field: ToolField = { key: value.key, label: value.label, type: value.type, ...(value.type === 'choice' && { options: value.options as string[] }), ...(value.composer === true && { composer: true }) };
  if (value.default !== undefined) {
    if (!fieldValue(field, value.default)) return null;
    field.default = value.default;
  }
  return field;
}

export function toolText(bytes: Uint8Array<ArrayBuffer>): ToolText {
  if (bytes.byteLength > TOOL_FILE_BYTES) return failed('tool-too-large');
  let code: string;
  try { code = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return failed('tool-encoding'); }
  return { ok: true, ...headerOf(code) };
}

function headerOf(code: string): { header: HeaderLine[]; body: string } {
  const lines = code.split(/\r?\n/);
  const header: HeaderLine[] = [];
  let next = 0;
  for (; next < lines.length; next++) {
    const line = lines[next]!;
    if (!line.trim()) continue;
    const match = /^\s*\/\/@([\w-]+)(?:\s+(.*))?$/.exec(line);
    if (!match) break;
    header.push({ key: match[1]!, value: match[2]?.trim() ?? '', written: line.trim() });
  }
  return { header, body: lines.slice(next).join('\n') };
}

// A studio draft keeps these header lines in its own fields and the rest of the file, the code's own header lines
// included, as its body; toolSource joins them into the file that is applied and exported.
const IDENTITY_KEYS: Record<string, keyof ToolIdentity | null> = { api: null, name: 'name', author: 'author', 'display-name': 'displayName', version: 'version', description: 'description' };

export function toolSource(identity: ToolIdentity, body: string): string {
  const lines = ['//@api 1', `//@name ${identity.name}`, `//@author ${identity.author}`, ...(identity.displayName ? [`//@display-name ${identity.displayName}`] : []), `//@version ${identity.version}`, ...(identity.description ? [`//@description ${identity.description}`] : [])];
  return `${lines.join('\n')}\n\n${body}`;
}

// found: the identity lines the text holds, for a body that should hold none.
export function splitTool(text: string): { identity: Partial<ToolIdentity>; found: HeaderLine[]; body: string } {
  const { header, body } = headerOf(text);
  const found = header.filter(({ key }) => Object.hasOwn(IDENTITY_KEYS, key));
  const kept = header.filter((line) => !found.includes(line)).map(({ written }) => written);
  const identity: Partial<ToolIdentity> = {};
  for (const { key, value } of found) {
    const field = IDENTITY_KEYS[key];
    if (field) identity[field] = value;
  }
  return { identity, found, body: kept.length > 0 ? `${kept.join('\n')}\n\n${body}` : body };
}

export function readTool(bytes: Uint8Array<ArrayBuffer>): ToolRead {
  const text = toolText(bytes);
  if (!text.ok) return text;
  const header = new Map<string, string>();
  const manifest: ToolManifest = { api: 1, name: '', author: '', displayName: '', version: '', description: '', uses: [], page: null, menu: [], settings: [], actions: [], composer: null };
  const actions = manifest.actions!;
  let unknown: string | null = null;
  for (const { key, value, written } of text.header) {
    if (key === 'setting') {
      let json: unknown;
      try { json = JSON.parse(value); } catch { return failed('tool-setting', written); }
      const field = fieldOf(json);
      if (!field || manifest.settings.some((each) => each.key === field.key)) return failed('tool-setting', written);
      manifest.settings.push(field);
    } else if (key === 'menu') {
      const item = /^(\S+)\s+(.+)$/.exec(value);
      if (!item || !identity(item[1]!) || manifest.menu.some((each) => each.id === item[1])) return failed('tool-menu', written);
      manifest.menu.push({ id: item[1]!, label: item[2]! });
    } else if (key === 'action') {
      const item = /^(\S+)\s+(.+)$/.exec(value);
      if (!item || !identity(item[1]!) || [...item[2]!].length > TOOL_ACTION_CHARS || actions.length === TOOL_ACTIONS || actions.some((each) => each.id === item[1])) return failed('tool-action', written);
      actions.push({ id: item[1]!, label: item[2]! });
    } else if (key === 'composer') {
      if (!value || [...value].length > TOOL_COMPOSER_CHARS || manifest.composer) return failed('tool-composer', written);
      manifest.composer = { label: value };
    } else if (key === 'uses') {
      const use = USES.find((each) => each === value);
      if (!use) return failed('tool-uses', written);
      if (!manifest.uses.includes(use)) manifest.uses.push(use);
    } else if (HEADER_KEYS.has(key)) header.set(key, value);
    else unknown ??= written;
  }
  if (!manifest.composer && manifest.settings.some((field) => field.composer)) return failed('tool-composer');
  if (header.get('api') !== '1') return failed('tool-api');
  // After the api check, so a file for another app is told it is not a tool at all.
  if (unknown) return failed('tool-unknown', unknown);
  const name = header.get('name') ?? '';
  const author = header.get('author') ?? '';
  if (!identity(name) || !identity(author)) return failed('tool-identity');
  Object.assign(manifest, { name, author, displayName: header.get('display-name') || name, version: header.get('version') ?? '', description: header.get('description') ?? '', page: header.get('page') ? { label: header.get('page')! } : null });
  return { ok: true, tool: { manifest, bytes } };
}
