import { additionalQuery, nearestParagraphs, paragraphs } from '../engine/additional';
import type { ChatScope } from '../engine/render';
import { quantize } from '../engine/retrieval';
import type { Receipt } from '../model/chat';
import { embedModel, type Route, type RouteFailure } from './assignment';
import { keepCall } from './chat-log';
import { countTexts, EMBED_TEXTS, embedTexts, type Embedded } from './embed';
import { saveVectors, vectorsOf } from './retrieval';
import type { Session } from './session';
import type { ObjectStore } from './store';

// Each chat's last send's paragraphs, by what they were found from: while that holds, a send asks again for nothing and
// a forecast, which makes no call, sends the same.
export type Additions = Map<string, { key: string; found: string[] }>;

export type AdditionalFailure = { kind: 'additional'; failure: RouteFailure | { kind: 'too-large' } | { kind: 'failed'; receipt: Receipt | null } };

type Scope = Pick<ChatScope, 'card' | 'messages' | 'persona' | 'greeting'>;

// null: nothing to find, with no paragraph or no message to ask with.
function asking(store: Pick<ObjectStore, 'get'>, scope: Scope): { route: Route; parts: string[]; query: string; key: string } | RouteFailure | null {
  const parts = paragraphs(scope.card?.additionalText ?? '');
  if (!parts.length) return null;
  const route = embedModel(store);
  if ('kind' in route) return route;
  const query = additionalQuery(scope);
  return query ? { route, parts, query, key: JSON.stringify([route.model.id, parts, query]) } : null;
}

export function lastAdditional({ store, additions }: Pick<Session, 'store' | 'additions'>, chat: string, scope: Scope): string[] {
  const asked = asking(store, scope);
  const last = additions.get(chat);
  return asked && !('kind' in asked) && last?.key === asked.key ? last.found : [];
}

// The card's paragraphs for a send, asked with the chat's opening. Each paragraph is embedded once a model and kept on
// the character (vectorsOf). With no 임베딩 모델, or a call that fails, the send stops, as Risu's does.
export async function findAdditional(session: Pick<Session, 'store' | 'read' | 'costs' | 'credentials' | 'log' | 'additions'>, chat: string, character: string, scope: Scope, signal: AbortSignal): Promise<string[] | AdditionalFailure> {
  const { store } = session;
  const asked = asking(store, scope);
  if (!asked) return [];
  if ('kind' in asked) return { kind: 'additional', failure: asked };
  const { route, parts, query, key } = asked;
  const last = session.additions.get(chat);
  if (last?.key === key) return last.found;
  const embed = async (texts: string[], as: 'document' | 'query') => {
    const embedded = await embedTexts({ credentials: session.credentials, log: session.log, count: countTexts(store) }, route, texts, as, chat, false, signal);
    if (embedded.receipt) await keepCall(session, chat, embedded.receipt);
    return embedded;
  };
  const failed = ({ answer, receipt }: { answer: Extract<Embedded, { ok: false }>; receipt: Receipt | null }): AdditionalFailure => ({ kind: 'additional', failure: answer.reason === 'too-large' ? { kind: 'too-large' } : { kind: 'failed', receipt } });
  const stored = vectorsOf(store, character)?.value;
  const held = stored?.model === route.model.id ? stored.items : {};
  // By paragraph in a Map, since a paragraph may be any text, a prototype's key among them.
  const vectors = new Map(parts.flatMap((part) => (Object.hasOwn(held, part) ? [[part, held[part]!] as const] : [])));
  const missing = parts.filter((part) => !vectors.has(part));
  for (let from = 0; from < missing.length; from += EMBED_TEXTS) {
    const batch = missing.slice(from, from + EMBED_TEXTS);
    const { answer, receipt } = await embed(batch, 'document');
    if (!answer.ok) return failed({ answer, receipt });
    const at = Date.now();
    batch.forEach((part, index) => vectors.set(part, quantize(answer.vectors[index]!, at)));
  }
  const items = Object.fromEntries(vectors);
  // A write that fails costs a later send these calls again, never this one its paragraphs.
  if (missing.length || Object.keys(held).some((part) => !vectors.has(part))) await saveVectors(store, character, { model: route.model.id, items });
  const { answer, receipt } = await embed([query], 'query');
  if (!answer.ok) return failed({ answer, receipt });
  const found = nearestParagraphs(answer.vectors[0]!, items);
  session.additions.set(chat, { key, found });
  return found;
}
