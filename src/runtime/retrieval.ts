import { recordText } from '../engine/memory';
import { nearest, quantize, rank } from '../engine/retrieval';
import type { HistoryMessage } from '../engine/history';
import type { Receipt } from '../model/chat';
import { vectorsId, type MemoryRecord, type Vector, type Vectors } from '../model/memory';
import type { Stored } from '../model/kinds';
import { embedModel, type Route } from './assignment';
import { keepCall } from './chat-log';
import { chatMemory } from './memory-read';
import { countTexts, EMBED_TEXTS, embedTexts, type Embedded } from './embed';
import type { Session } from './session';
import type { ObjectStore } from './store';

type Reader = Pick<Session, 'store' | 'read' | 'credentials' | 'costs' | 'log'>;

export const chatVectors = (store: Pick<ObjectStore, 'children'>, chat: string): Stored<'vectors'> | undefined => store.children('vectors', chat).find((entry) => entry.id === vectorsId(chat));

// Which live records have no vector at the current 임베딩 모델 (design §6.2, Retrieval): every one, when the vectors
// were written by another model. null when retrieval is off, with no model to embed with.
export function unembedded(store: Pick<ObjectStore, 'get' | 'children'>, chat: string): { route: Route; records: MemoryRecord[]; kept: Record<string, Vector>; stale: boolean } | null {
  const route = embedModel(store);
  if ('kind' in route) return null;
  const vectors = chatVectors(store, chat);
  const items = vectors?.value.model === route.model.id ? vectors.value.items : {};
  const live = chatMemory(store, chat).records.filter((record) => !record.forgotten);
  const records: MemoryRecord[] = [];
  const kept: Record<string, Vector> = {};
  for (const record of live) {
    const vector = items[record.id];
    if (vector?.at === record.at) kept[record.id] = vector;
    else records.push(record);
  }
  const stale = vectors !== undefined && (vectors.value.model !== route.model.id || Object.keys(items).some((id) => !live.some((record) => record.id === id)));
  return { route, records, kept, stale };
}

const SAVE_EVERY = 60_000;

export type Indexed = { ok: true } | { ok: false; reason: Extract<Embedded, { ok: false }>['reason']; receipt: Receipt | null };

// Embed missing/stale records in EMBED_TEXTS batches; preserve earlier vectors on failure and drop obsolete ones.
// Checkpoint long runs every SAVE_EVERY so retrieval/reloads can use partial progress.
export async function indexRecords(session: Reader, chat: string, signal: AbortSignal, progress: (done: number) => void): Promise<Indexed> {
  const { store } = session;
  const missing = unembedded(store, chat);
  if (!missing) return { ok: true };
  const { route, records, kept: items, stale } = missing;
  if (!records.length && !stale) return { ok: true };
  let done = 0;
  let saved = Date.now();
  for (let from = 0; from < records.length; from += EMBED_TEXTS) {
    const batch = records.slice(from, from + EMBED_TEXTS);
    const { answer, receipt } = await embedTexts({ credentials: session.credentials, log: session.log, count: countTexts(store) }, route, batch.map(recordText), 'document', chat, false, signal, (count) => progress((done += count)));
    if (receipt) await keepCall(session, chat, receipt);
    if (!answer.ok) {
      if (Object.keys(items).length) await writeVectors(store, chat, { model: route.model.id, items });
      return { ok: false, reason: answer.reason, receipt };
    }
    batch.forEach((record, index) => (items[record.id] = quantize(answer.vectors[index]!, record.at)));
    if (from + EMBED_TEXTS < records.length && Date.now() - saved >= SAVE_EVERY) {
      await writeVectors(store, chat, { model: route.model.id, items });
      saved = Date.now();
    }
  }
  await writeVectors(store, chat, { model: route.model.id, items });
  return { ok: true };
}

async function writeVectors(store: ObjectStore, chat: string, value: Vectors) {
  return store.withChat(chat, async () => {
    const id = vectorsId(chat);
    if (!chatVectors(store, chat)) {
      const created = await store.create('vectors', value, { id, parent: chat });
      if (created.ok || created.error !== 'conflict' || !chatVectors(store, chat)) return created;
    }
    return store.update('vectors', id, () => value);
  });
}

// What the latest message asks about: the latest user message, and under QUERY_LEAST characters the end of the reply
// before it too, since "응" or "그래서?" alone names nothing (unruled, 2026-10-09).
const QUERY_LEAST = 40;
const QUERY_CONTEXT = 600;
export function queryOf(messages: HistoryMessage[]): string | null {
  const at = messages.findLastIndex(({ role }) => role === 'user');
  if (at === -1) return null;
  const asked = messages[at]!.text.trim();
  if (asked.length >= QUERY_LEAST) return asked;
  const before = messages.slice(0, at).findLast(({ role }) => role === 'assistant')?.text.trim().slice(-QUERY_CONTEXT) ?? '';
  const query = [before, asked].filter(Boolean).join('\n');
  return query || null;
}

export function retrievalOf(store: Pick<ObjectStore, 'get' | 'children'>, chat: string, messages: HistoryMessage[]): { route: Route; items: Record<string, Vector>; query: string } | null {
  const route = embedModel(store);
  if ('kind' in route) return null;
  const vectors = chatVectors(store, chat);
  if (vectors?.value.model !== route.model.id || !Object.keys(vectors.value.items).length) return null;
  const query = queryOf(messages);
  return query ? { route, items: vectors.value.items, query } : null;
}

const QUERY_WAIT = 5000;

// The records nearest the latest message, nearest first, for a send: none without an 임베딩 모델, vectors at it, or an
// answer within QUERY_WAIT, since retrieval never holds or fails a send.
export async function findRecords(session: Reader, chat: string, messages: HistoryMessage[], signal: AbortSignal): Promise<string[]> {
  const { store } = session;
  const found = retrievalOf(store, chat, messages);
  if (!found) return [];
  const { route, items, query } = found;
  const { answer, receipt } = await embedTexts({ credentials: session.credentials, log: session.log, count: countTexts(store) }, route, [query], 'query', chat, false, AbortSignal.any([signal, AbortSignal.timeout(QUERY_WAIT)]));
  if (receipt) await keepCall(session, chat, receipt);
  return answer.ok ? nearest(rank(answer.vectors[0]!, items)) : [];
}
