import { costUnit, resolveConnection, type CacheFacts, type CacheView } from '../connectors/registry';
import { priceCost } from '../connectors/pricing';
import type { Cache } from '../connectors/settings';
import type { Connection, Model } from '../connectors/types';
import { fingerprint } from '../engine/memory';
import type { Assembled, From } from '../engine/pipeline';
import { cachePrintId, type CacheBreak, type CacheBreakCost, type CacheForecast, type CachePrint, type CacheText, type Forecast, type ForecastPart, type WireMessage } from '../model/cache';
import type { Message, Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { ObjectStore } from './store';

const TTL: Record<Cache, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 };

type LastCache = { call: string; until: number };

// The call left a cache to forecast against: it sent a point and reported reading or writing some. One that cached
// none (a prompt shorter than the model caches, a provider that ignores points, a call that failed) leaves the last.
export const cacheKept = ({ cache, usage }: Pick<Receipt, 'cache' | 'usage'>) => cache !== null && ((usage?.cachedInputTokens ?? 0) > 0 || (usage?.cacheWriteInputTokens ?? 0) > 0);

// A provider keeps a cache for the call's TTL from the call's start, and a read renews it as a write does. null when the
// chat's latest call that reported its counts kept none.
export function lastCache(messages: Message[]): LastCache | null {
  let latest: { at: number; receipt: Receipt } | null = null;
  for (const message of messages) {
    for (const { at, receipt } of message.versions) if (receipt?.usage && (!latest || at > latest.at)) latest = { at, receipt };
  }
  if (!latest) return null;
  const { cache, totalMs } = latest.receipt;
  return cacheKept(latest.receipt) ? { call: latest.receipt.id, until: latest.at - totalMs + TTL[cache!] } : null;
}

// Forecast minimums are o200k allowances from the conversation snapshot, not the connector's native counts.
export type CacheSend = Omit<CachePrint, 'call'> & { facts: CacheFacts | null };

export function wireOf(connection: string, account: string | null, view: CacheView, parts: Assembled['parts']): Omit<CachePrint, 'call'> {
  const messages = view.messages.map(({ role, content, index, cache }): WireMessage => ({ role, hash: fingerprint([{ role, text: content }]), tokens: parts[index]!.tokens, from: parts[index]!.from, ...(cache && { point: true as const }) }));
  return { connection, account, model: view.model, ...(view.reasoning !== undefined && { reasoning: view.reasoning }), messages };
}

export const wireTextOf = (view: CacheView): CacheText => view.messages.map(({ content, index }) => ({ content, index }));

export const chatPrint = (store: Pick<ObjectStore, 'children'>, chat: string): Stored<'cacheprint'> | undefined =>
  store.children('cacheprint', chat).find((print) => print.id === cachePrintId(chat));

// Replaced by each reply call that kept a cache (cacheKept), the one lastCache names.
export function writePrint(store: ObjectStore, chat: string, call: string, { connection, account, model, reasoning, messages }: Omit<CachePrint, 'call'>) {
  const value: CachePrint = { call, connection, account, model, ...(reasoning !== undefined && { reasoning }), messages };
  return store.withChat(chat, async () => {
    const id = cachePrintId(chat);
    if (!chatPrint(store, chat)) {
      const created = await store.create('cacheprint', value, { id, parent: chat });
      if (created.ok || created.error !== 'conflict' || !chatPrint(store, chat)) return created;
    }
    return store.update('cacheprint', id, () => value);
  });
}

// The last call to forecast against: the stored print, when it is of the call whose receipt keeps the cache's time.
// live: the time is not up at now.
export type Prior = { print: CachePrint; live: boolean };

export function prior(store: Pick<ObjectStore, 'children'>, chat: string, messages: Message[], now: number): Prior | null {
  const last = lastCache(messages);
  const print = chatPrint(store, chat)?.value;
  return last && print?.call === last.call ? { print, live: last.until > now } : null;
}

type Change = Extract<CacheBreak, { from: From }> & { at: number; before: number | null };

const sums = (messages: WireMessage[]) => {
  let sum = 0;
  return messages.map(({ tokens }) => (sum += tokens));
};
// Without the id, which a print stored before it was kept lacks.
const place = (from: From) => JSON.stringify({ ...from, id: undefined });
const sameFrom = (a: WireMessage, b: WireMessage) => a.role === b.role && (place(a.from) === place(b.from) || a.from.kind === 'block' && a.from.slot === 'chat' && b.from.kind === 'block' && b.from.slot === 'chat');

// Every message that differs from the last call's, in wire order, up to where the last call's cached prompt ends in
// the next send: what follows it there is the chat going on, not a change. One the next send has that the last call's
// cached prompt did not is changed when it stands in for a removed one from the same part, else added; one the last
// call cached that the next does not send is removed. A removed one sorts first at the same place.
function changes(before: WireMessage[], after: WireMessage[], same: number, end: number): Change[] {
  const cached = before.slice(same, end + 1);
  const positions = new Map<string, number[]>();
  for (let index = cached.length - 1; index >= 0; index--) {
    const { role, hash } = cached[index]!;
    const key = `${role}:${hash}`;
    const held = positions.get(key);
    if (held) held.push(index);
    else positions.set(key, [index]);
  }
  const paired = new Map<number, number>();
  const used = new Set<number>();
  for (let index = same; index < after.length; index++) {
    const { role, hash } = after[index]!;
    const old = positions.get(`${role}:${hash}`)?.pop();
    if (old !== undefined) { paired.set(index, same + old); used.add(old); }
  }
  // Chat is the frame entries move against: keep the most chat parts first, then the most parts overall.
  const order = [...paired].map(([at, old]) => {
    const { from } = after[at]!;
    return { at, old, score: 1 + (from.kind === 'block' && from.slot === 'chat' ? paired.size + 1 : 0), previous: -1 };
  });
  let best = -1;
  for (let index = 0; index < order.length; index++) {
    const current = order[index]!;
    const weight = current.score;
    for (let earlier = 0; earlier < index; earlier++) {
      const previous = order[earlier]!;
      if (previous.old < current.old && previous.score + weight > current.score) {
        current.score = previous.score + weight;
        current.previous = earlier;
      }
    }
    if (best === -1 || current.score > order[best]!.score) best = index;
  }
  const kept = new Set<number>();
  while (best !== -1) {
    kept.add(order[best]!.at);
    best = order[best]!.previous;
  }
  const gone = cached.flatMap((message, index) => used.has(index) ? [] : [{ message, at: same + index }]);
  const bound = Math.max(same + gone.length - 1, ...paired.keys());
  const found: Change[] = [];
  for (let index = same; index <= bound && index < after.length; index++) {
    const message = after[index]!;
    const old = paired.get(index);
    if (old !== undefined) {
      if (!kept.has(index)) found.push({ kind: 'moved', from: message.from, role: message.role, at: index, before: old });
      continue;
    }
    const pair = gone.findIndex((old) => sameFrom(old.message, message));
    const previous = pair === -1 ? null : gone.splice(pair, 1)[0]!.at;
    found.push({ kind: pair === -1 ? 'added' : 'changed', from: message.from, role: message.role, at: index, before: previous });
  }
  for (const { message, at: index } of gone) found.push({ kind: 'removed', from: message.from, role: message.role, at: index, before: index });
  return found.sort((a, b) => a.at - b.at || (a.kind === 'removed' ? -1 : b.kind === 'removed' ? 1 : 0));
}

// A provider reads its cache only where a point of the last call stood, as far as both requests match from their
// start, and only from a point of the next send within its lookback after it. A point whose prompt is under the
// model's minimum caches nothing, so a last call none of whose points reach it is not compared. null when the next
// send marks no point and there is no last call to compare.
export function forecast(last: Prior | null, next: CacheSend): Forecast | null {
  const after = next.messages;
  const nextPoints = after.flatMap((message, index) => (message.point ? [index] : []));
  if (!last && !nextPoints.length) return null;
  const minimum = next.facts?.minimum ?? null;
  const lookback = next.facts?.lookback ?? null;
  const upTo = sums(after);
  const caches = (sum: number) => minimum === null || sum >= minimum;
  const writeEnd = nextPoints.findLast((point) => caches(upTo[point]!)) ?? -1;

  let readEnd = -1;
  let against: CacheForecast | null = null;
  let found: Change[] = [];
  const before = last?.print.messages ?? [];
  const had = sums(before);
  const points = before.flatMap((message, index) => (message.point && caches(had[index]!) ? [index] : []));
  if (last && points.length) {
    const of = had[points.at(-1)!]!;
    const none = (broken: CacheBreak): CacheForecast => ({ read: 0, of, broken });
    let same = 0;
    while (same < before.length && same < after.length && before[same]!.role === after[same]!.role && before[same]!.hash === after[same]!.hash) same++;
    found = changes(before, after, same, points.at(-1)!);
    const { print } = last;
    if (!last.live) against = none({ kind: 'expired' });
    else if (next.connection !== print.connection || next.model !== print.model) against = none({ kind: 'model' });
    else if (print.account !== null && next.account !== null && next.account !== print.account) against = none({ kind: 'account' });
    else if (JSON.stringify(next.reasoning) !== JSON.stringify(print.reasoning)) against = none({ kind: 'reasoning' });
    else if (!nextPoints.length) against = none({ kind: 'off' });
    else {
      const matched = points.filter((point) => point < same);
      readEnd = matched.findLast((point) => nextPoints.some((at) => at >= point && (lookback === null || at - point <= lookback))) ?? -1;
      const read = readEnd === -1 ? 0 : upTo[readEnd]!;
      const broken: CacheBreak | null = readEnd === points.at(-1) ? null : matched.at(-1) === points.at(-1) ? { kind: 'far' } : found[0] ? { kind: found[0].kind, from: found[0].from, role: found[0].role } : null;
      against = { read, of, broken };
    }
  }

  const changed = new Map(found.flatMap((change) => (change.kind === 'removed' ? [] : [[change.at, { kind: change.kind, before: change.before }] as const])));
  const parts = after.map(({ role, from, tokens, point }, index): ForecastPart => ({
    role,
    from,
    tokens,
    state: index <= readEnd ? 'read' : index <= writeEnd ? 'write' : 'tail',
    change: changed.get(index)?.kind ?? null,
    before: changed.get(index)?.before ?? null,
    point: point ? (caches(upTo[index]!) ? 'cache' : 'short') : null,
  }));
  const removed = found.flatMap((change) => (change.kind === 'removed' ? [{ role: change.role, from: change.from, tokens: before[change.at]!.tokens, before: change.at }] : []));
  const read = readEnd === -1 ? 0 : upTo[readEnd]!;
  const cached = writeEnd === -1 ? read : upTo[writeEnd]!;
  return { parts, removed, written: cached - read, tail: (upTo.at(-1) ?? 0) - cached, against };
}

// What the next send's input would cost as forecast, and had it read all the last call cached, from the model's
// price; null without one. Both write what the next send caches past what they read. ratio: the model's native tokens
// per o200k token (the send's calibrated centre), since the provider bills its own count and parts hold o200k.
export function breakCost(connection: Connection, model: Model, { parts, written, against }: Forecast, ratio: number): CacheBreakCost | null {
  if (!model.price || !against?.broken) return null;
  const native = (count: number) => Math.round(count * ratio);
  const inputTokens = native(parts.reduce((sum, { tokens }) => sum + tokens, 0));
  const unit = costUnit(resolveConnection(connection)?.type ?? null);
  const cost = (cached: number, write: number) => priceCost(model.price!, { inputTokens, outputTokens: 0, reasoningTokens: null, cachedInputTokens: native(cached), cacheWriteInputTokens: native(write) }, unit);
  const ends = against.read + written;
  const paid = cost(against.read, written);
  const whole = cost(Math.min(against.of, ends), Math.max(ends - against.of, 0));
  return paid && whole && { paid, whole };
}
