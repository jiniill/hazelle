import { additionalQuery, nearestParagraphs, paragraphs } from '../engine/additional';
import type { ChatScope } from '../engine/render';
import { quantize } from '../engine/retrieval';
import { embedModel, type Route, type RouteFailure } from './assignment';
import { embedBatches, embedKept, saveVectors, vectorsOf, type EmbedFailure } from './retrieval';
import type { Session } from './session';
import type { ObjectStore } from './store';

type Asked = { model: string; text: string; query: string };

// Each chat's last send's paragraphs, by what they were found from: while that holds, a send asks again for nothing and
// a forecast, which makes no call, sends the same.
export type Additions = Map<string, Asked & { found: string[] }>;

export type AdditionalFailure = { kind: 'additional'; failure: RouteFailure | EmbedFailure };

type Scope = Pick<ChatScope, 'card' | 'messages' | 'persona' | 'greeting'>;

// null: nothing to find, with no paragraph or no message to ask with.
function asking(store: Pick<ObjectStore, 'get'>, scope: Scope): (Asked & { route: Route; parts: string[] }) | RouteFailure | null {
  const text = scope.card?.additionalText ?? '';
  const parts = paragraphs(text);
  if (!parts.length) return null;
  const route = embedModel(store);
  if ('kind' in route) return route;
  const query = additionalQuery(scope);
  return query ? { route, parts, model: route.model.id, text, query } : null;
}

const lastOf = (additions: Additions, chat: string, asked: Asked) => {
  const last = additions.get(chat);
  return last && last.model === asked.model && last.text === asked.text && last.query === asked.query ? last.found : null;
};

export function lastAdditional({ store, additions }: Pick<Session, 'store' | 'additions'>, chat: string, scope: Scope): string[] {
  const asked = asking(store, scope);
  return (asked && !('kind' in asked) && lastOf(additions, chat, asked)) || [];
}

// The card's paragraphs for a send, asked with the chat's opening. Each paragraph is embedded once a model and kept on
// the character (vectorsOf). With no 임베딩 모델, or a call that fails, the send stops, as Risu's does.
export async function findAdditional(session: Pick<Session, 'store' | 'read' | 'costs' | 'credentials' | 'log' | 'additions'>, chat: string, character: string, scope: Scope, signal: AbortSignal): Promise<string[] | AdditionalFailure> {
  const { store } = session;
  const asked = asking(store, scope);
  if (!asked) return [];
  if ('kind' in asked) return { kind: 'additional', failure: asked };
  const last = lastOf(session.additions, chat, asked);
  if (last) return last;
  const { route, parts, query } = asked;
  const stored = vectorsOf(store, character)?.value;
  const held = stored?.model === route.model.id ? stored.items : {};
  // By paragraph in a Map, since a paragraph may be any text, a prototype's key among them.
  const vectors = new Map(parts.flatMap((part) => (Object.hasOwn(held, part) ? [[part, held[part]!] as const] : [])));
  const missing = parts.filter((part) => !vectors.has(part));
  const took = (from: number, got: number[][]) => {
    const at = Date.now();
    got.forEach((vector, index) => vectors.set(missing[from + index]!, quantize(vector, at)));
    return null;
  };
  const [failed, { answer, receipt }] = await Promise.all([embedBatches(session, route, chat, missing, signal, took), embedKept(session, route, [query], 'query', chat, signal)]);
  if (failed) return { kind: 'additional', failure: failed };
  const items = Object.fromEntries(vectors);
  // A write that fails costs a later send these calls again, never this one its paragraphs.
  if (missing.length || Object.keys(held).some((part) => !vectors.has(part))) await saveVectors(store, character, { model: route.model.id, items });
  if (!answer.ok) return { kind: 'additional', failure: { kind: 'embed', reason: answer.reason, receipt } };
  const found = nearestParagraphs(answer.vectors[0]!, items);
  session.additions.set(chat, { model: asked.model, text: asked.text, query, found });
  return found;
}
