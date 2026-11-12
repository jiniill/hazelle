import type { EmbedPurpose } from '../../connectors/types';
import { recordText } from '../../engine/memory';
import { nearest, quantize, rank } from '../../engine/retrieval';
import type { HistoryMessage } from '../../engine/history';
import type { Receipt } from '../../model/chat';
import { vectorsId, type MemoryRecord, type Vector, type Vectors } from '../../model/memory';
import { isValue, type Stored } from '../../model/kinds';
import type { ApiFailure } from '../api';
import { embedModel, type Route } from '../models/assignment';
import { keepCall } from '../chat/chat-log';
import { chatMemory } from './memory-read';
import { countTexts, EMBED_TEXTS, embedTexts, type Embedded } from '../models/embed';
import type { Session } from '../session';
import type { ObjectStore } from '../store/store';

type Reader = Pick<Session, 'store' | 'read' | 'credentials' | 'costs' | 'log'>;

// owner: the chat whose records, or the character whose additionalText (runtime/chat/additional), the vectors are of.
export const vectorsOf = (store: Pick<ObjectStore, 'children'>, owner: string): Stored<'vectors'> | undefined => store.children('vectors', owner).find((entry) => entry.id === vectorsId(owner) && isValue('vectors', entry.value));

// Which live records have no vector at the current 임베딩 모델 (design §6.2, Retrieval): every one, when the vectors
// were written by another model. null when retrieval is off, with no model to embed with.
export function unembedded(store: Pick<ObjectStore, 'get' | 'children'>, chat: string): { route: Route; records: MemoryRecord[]; kept: Record<string, Vector>; stale: boolean } | null {
  const route = embedModel(store);
  if ('kind' in route) return null;
  const vectors = vectorsOf(store, chat);
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

export type Indexed = { ok: true } | { ok: false; reason: EmbedFailure['reason']; receipt: Receipt | null } | { ok: false; failure: ApiFailure };

export type EmbedFailure = { kind: 'embed'; reason: Extract<Embedded, { ok: false }>['reason']; receipt: Receipt | null };

// One call, kept in the chat's log.
export async function embedKept(session: Reader, route: Route, texts: string[], as: EmbedPurpose, chat: string, signal: AbortSignal, progress?: (count: number) => void) {
  const embedded = await embedTexts({ credentials: session.credentials, log: session.log, count: countTexts(session.store) }, route, texts, as, chat, false, signal, progress);
  if (embedded.receipt) await keepCall(session, chat, 'embedding', embedded.receipt);
  return embedded;
}

// texts as documents in EMBED_TEXTS batches, each batch's vectors handed to took, by where the batch starts, before the
// next is asked; stops at the first call that fails or the first failure took returns.
export async function embedBatches<F = never>(session: Reader, route: Route, chat: string, texts: string[], signal: AbortSignal, took: (from: number, vectors: number[][]) => Promise<F | null> | null, progress?: (count: number) => void): Promise<EmbedFailure | F | null> {
  for (let from = 0; from < texts.length; from += EMBED_TEXTS) {
    const { answer, receipt } = await embedKept(session, route, texts.slice(from, from + EMBED_TEXTS), 'document', chat, signal, progress);
    if (!answer.ok) return { kind: 'embed', reason: answer.reason, receipt };
    const failed = await took(from, answer.vectors);
    if (failed) return failed;
  }
  return null;
}

// Embed missing/stale records in EMBED_TEXTS batches; preserve earlier vectors on failure and drop obsolete ones.
// Checkpoint long runs every SAVE_EVERY so retrieval/reloads can use partial progress.
export async function indexRecords(session: Reader, chat: string, signal: AbortSignal, progress: (done: number) => void): Promise<Indexed> {
  const { store } = session;
  const missing = unembedded(store, chat);
  if (!missing) return { ok: true };
  const { route, records, kept: items, stale } = missing;
  if (!records.length && !stale) return { ok: true };
  const save = () => store.withChat(chat, () => saveVectors(store, chat, { model: route.model.id, items }));
  let done = 0;
  let saved = Date.now();
  const failed = await embedBatches(session, route, chat, records.map(recordText), signal, async (from, vectors) => {
    vectors.forEach((vector, index) => {
      const record = records[from + index]!;
      items[record.id] = quantize(vector, record.at);
    });
    if (from + EMBED_TEXTS >= records.length || Date.now() - saved < SAVE_EVERY) return null;
    const checkpoint = await save();
    saved = Date.now();
    return checkpoint.ok ? null : checkpoint;
  }, (count) => progress((done += count)));
  if (failed && !('kind' in failed)) return { ok: false, failure: failed };
  if (failed) {
    if (Object.keys(items).length) {
      const saved = await save();
      if (!saved.ok) return { ok: false, failure: saved };
    }
    return { ok: false, reason: failed.reason, receipt: failed.receipt };
  }
  const final = await save();
  return final.ok ? { ok: true } : { ok: false, failure: final };
}

export async function saveVectors(store: ObjectStore, owner: string, value: Vectors) {
  const id = vectorsId(owner);
  // By id, not vectorsOf: a broken stored value is overwritten by a fresh index rather than conflicting forever.
  if (!store.get('vectors', id)) {
    const created = await store.create('vectors', value, { id, parent: owner });
    if (created.ok || created.error !== 'conflict' || !store.get('vectors', id)) return created;
  }
  return store.update('vectors', id, () => value);
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
  const vectors = vectorsOf(store, chat);
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
  const { answer } = await embedKept(session, route, [query], 'query', chat, AbortSignal.any([signal, AbortSignal.timeout(QUERY_WAIT)]));
  return answer.ok ? nearest(rank(answer.vectors[0]!, items)) : [];
}
