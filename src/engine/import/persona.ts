import { fromBase64, toBase64 } from '../../base64';
import { isRecord } from '../../connectors/values';
import type { Persona } from '../../model/persona';
import { text } from './convert';
import { withText } from './png';
import type { ImportResult } from './types';

// A Risu persona record, from a backup's list or a persona PNG.
export const risuPersonaFields = (raw: Record<string, unknown>) => ({ name: text(raw.name), alias: text(raw.note).trim(), description: text(raw.personaPrompt) });

// Risu's importUserPersona takes a persona only with a name and a prompt.
export function readPersona(payload: string, image: Uint8Array<ArrayBuffer>): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64(payload)));
  } catch {
    return { ok: false, failure: { kind: 'unreadable', detail: 'persona-unreadable' } };
  }
  if (!isRecord(raw)) return { ok: false, failure: { kind: 'unreadable', detail: 'persona-unreadable' } };
  const fields = risuPersonaFields(raw);
  if (!fields.name || !fields.description) return { ok: false, failure: { kind: 'unreadable', detail: 'persona-incomplete' } };
  return { ok: true, persona: { ...fields, picture: async () => ({ bytes: image, type: 'image/png' }) } };
}

// Risu's exportUserPersona (export spec §4): png, already a PNG, with one tEXt chunk `persona`, base64 of the UTF-8 JSON
// that risuPersonaFields reads. Risu refuses an empty description on import, so a caller never writes one.
export function writePersonaPng(png: Uint8Array, { name, description, alias }: Pick<Persona, 'name' | 'description' | 'alias'>): Uint8Array<ArrayBuffer> {
  return withText(png, 'persona', toBase64(new TextEncoder().encode(JSON.stringify({ name, personaPrompt: description, note: alias }))));
}
