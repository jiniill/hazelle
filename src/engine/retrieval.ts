import type { Memory, Vector } from '../model/memory';
import { placesOf, recalledText, recordText, type ChatRead, type Standing } from './memory';

// Retrieve after the last cache point, on top of memory budget within RETRIEVAL_SHARE.
// Slot-sent summaries contribute their whole source messages; otherwise contribute summaries, never partial messages.
const RETRIEVAL_SHARE = 0.2;
export const retrievalRoom = (budget: number) => Math.floor(budget * RETRIEVAL_SHARE);

// Require LEAST vectors before judging median similarity. GAP 0.075 favors recall (user, 2026-10-12):
// 16/35 hits vs 13 at 0.1; 0.05 retrieved on over half of ordinary sends (voyage-4, memory-eval-2026-10.md).
const MOST = 3;
const LEAST = 4;
const GAP = 0.075;

const unit = (values: ArrayLike<number>) => {
  const length = Math.hypot(...Array.from(values));
  return Float32Array.from(values, (value) => (length ? value / length : 0));
};

export function quantize(values: number[], at: number): Vector {
  const normal = unit(values);
  const scale = normal.reduce((most, value) => Math.max(most, Math.abs(value)), 0) || 1;
  const bytes = Int8Array.from(normal, (value) => Math.round((value / scale) * 127));
  return { at, scale, data: btoa(String.fromCharCode(...new Uint8Array(bytes.buffer))) };
}

export const dequantize = ({ scale, data }: Vector): Float32Array => {
  const bytes = new Int8Array(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)).buffer);
  return unit(Float32Array.from(bytes, (byte) => (byte / 127) * scale));
};

const dot = (a: Float32Array, b: Float32Array) => {
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += a[index]! * b[index]!;
  return sum;
};

// Nearest first; a vector of another length than the query's (another model's) is left out.
export function rank(query: number[], items: Record<string, Vector>): { id: string; similarity: number }[] {
  const asked = unit(query);
  return Object.entries(items)
    .map(([id, vector]) => ({ id, vector: dequantize(vector) }))
    .filter(({ vector }) => vector.length === asked.length)
    .map(({ id, vector }) => ({ id, similarity: dot(asked, vector) }))
    .sort((a, b) => b.similarity - a.similarity);
}

export function nearest(ranked: { id: string; similarity: number }[]): string[] {
  if (ranked.length < LEAST) return [];
  const sorted = ranked.map(({ similarity }) => similarity).sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return ranked
    .slice(0, MOST)
    .filter(({ similarity }) => similarity - median >= GAP)
    .map(({ id }) => id);
}

export const RETRIEVED_HEADING = 'Earlier in this chat, found for the latest message:';

// found: record ids, nearest first. A record the slot sends gives its messages; one it holds back as over or in its
// chapter gives its summary; a stale, forgotten or put-in (이 기억 넣기) one gives nothing. Each must fit the room left.
export function retrieval(memory: Memory, found: string[], standing: Pick<Standing, 'status'>, chat: ChatRead, room: number, countTokens: (text: string) => number): { ids: string[]; text: string } | null {
  const places = placesOf(chat.shown);
  const ids: string[] = [];
  const texts: string[] = [];
  let left = room;
  for (const id of found) {
    const record = memory.records.find((each) => each.id === id);
    const status = standing.status.get(id);
    if (!record || record.forgotten || record.recalled || status === undefined || status === 'stale' || status === 'forgotten') continue;
    const text = status === 'sent' ? recalledText(record, chat, places) : recordText(record);
    const cost = countTokens(text);
    if (cost > left) continue;
    left -= cost;
    ids.push(id);
    texts.push(text);
  }
  return ids.length ? { ids, text: [RETRIEVED_HEADING, ...texts].join('\n\n') } : null;
}
