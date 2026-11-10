import { isRecord } from '../record';
import type { Modality } from './types';

// OpenRouter names an embedding model's output embeddings.
const MODALITIES: Partial<Record<string, Modality>> = { text: 'text', image: 'image', audio: 'audio', video: 'video', file: 'file', embedding: 'embedding', embeddings: 'embedding' };

export function modalities(value: unknown): Modality[] | null {
  return Array.isArray(value) ? value.flatMap((item) => MODALITIES[String(item)] ?? []) : null;
}

export const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// Vercel's credits and NanoGPT's balance come as decimal strings, such as "95.50".
export function decimal(value: unknown): number | null {
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : amount(value);
}

// OpenRouter and Vercel price per token, as decimal strings; prices here are per million tokens.
export function perMillion(value: unknown): number | null {
  const rate = decimal(value);
  return rate === null ? null : rate * 1_000_000;
}

export const vector = (value: unknown): value is number[] => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isFinite(item));

export function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export const toggle = <T>(items: readonly T[], item: T): T[] => (items.includes(item) ? items.filter((each) => each !== item) : [...items, item]);

type Entry = Record<string, unknown> & { id: string };

// null when the payload is not a model list at all, which is not the same as an empty one.
export function modelEntries(payload: unknown): Entry[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  return payload.data.filter((raw): raw is Entry => isRecord(raw) && typeof raw.id === 'string' && raw.id !== '');
}

export function nameOf(raw: Entry, field: string): string {
  const name = raw[field];
  return typeof name === 'string' && name ? name : raw.id;
}
