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

// until is null where no point was sent: a provider that caches on its own keeps it for as long as it chooses.
type LastCache = { call: string; until: number | null };

// The call left a cache to forecast against: it sent a point and reported reading or writing some. One that cached
// none (a prompt shorter than the model caches, a provider that ignores points, a call that failed) leaves the last.
export const cacheKept = ({ cache, usage }: Pick<Receipt, 'cache' | 'usage'>) => cache !== null && ((usage?.cachedInputTokens ?? 0) > 0 || (usage?.cacheWriteInputTokens ?? 0) > 0);

// Without points a provider that caches at all keeps every call's prompt, and only a read it reports shows that it
// does: this call's, or the one the chat's print is of on the same connection and model. Model names are not read.
export function prefixKept(store: Pick<ObjectStore, 'children'>, chat: string, { cache, usage, connection, model }: Pick<Receipt, 'cache' | 'usage' | 'connection' | 'model'>): boolean {
  if (cache !== null || !usage) return false;
  if ((usage.cachedInputTokens ?? 0) > 0) return true;
  const print = chatPrint(store, chat)?.value;
  return !!print && print.connection === connection && print.model === model && !print.messages.some(({ point }) => point);
}

// A provider keeps a cache for the call's TTL from the call's start, and a read renews it as a write does. null when the
// chat's latest call that reported its counts kept none. A call that sent no point is named whether or not it kept a
// prefix, since prior matches it only to a print prefixKept let it write.
export function lastCache(messages: Message[]): LastCache | null {
  let latest: { at: number; receipt: Receipt } | null = null;
  for (const message of messages) {
    for (const { at, receipt } of message.versions) if (receipt?.usage && (!latest || at > latest.at)) latest = { at, receipt };
  }
  if (!latest) return null;
  const { cache, totalMs } = latest.receipt;
  if (cache === null) return { call: latest.receipt.id, until: null };
  return cacheKept(latest.receipt) ? { call: latest.receipt.id, until: latest.at - totalMs + TTL[cache] } : null;
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

// Replaced by each reply call that kept a cache (cacheKept, prefixKept), the one lastCache names.
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
  return last && print?.call === last.call ? { print, live: last.until === null || last.until > now } : null;
}

type Change = Extract<CacheBreak, { from: From }> & { at: number; before: number | null };

const sums = (messages: WireMessage[]) => {
  let sum = 0;
  return messages.map(({ tokens }) => (sum += tokens));
};
// Without the id, which a print stored before it was kept lacks.
const place = (from: From) => JSON.stringify({ ...from, id: undefined });
const sameFrom = (a: WireMessage, b: WireMessage) => a.role === b.role && (place(a.from) === place(b.from) || a.from.kind === 'block' && a.from.slot === 'chat' && b.from.kind === 'block' && b.from.slot === 'chat');

// Compare wire order only through the old cached prefix; later conversation is not a change.
// Pair replacements within one source part, otherwise mark additions; sort removals first at equal positions.
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

const isChat = ({ from }: WireMessage) => from.kind === 'block' && from.slot === 'chat';

// The chat's growth is the one change no prompt avoids. grown: the new send's first chat message after the last one the
// last call also sent (after.length when none); end: the last call's part a prefix read can reach, its last chat
// message when the chat grew, else its last part. Whatever stands between chat messages is expected to stay in place.
function growth(before: WireMessage[], after: WireMessage[]) {
  const sent = new Set(before.filter(isChat).map(({ hash }) => hash));
  const kept = after.findLastIndex((message) => isChat(message) && sent.has(message.hash));
  const grown = after.findIndex((message, index) => index > kept && isChat(message));
  return grown === -1 ? { grown: after.length, end: before.length - 1 } : { grown, end: before.findLastIndex(isChat) };
}

// Points: reuse only matching prefixes ending at an old point reachable from a new point's lookback, ignoring old points
// below the model minimum. No point on either side: the provider caches on its own and reads the longest prefix the
// last call shares, which ends at a part boundary here and may run into the next part there. No new points/prior cache
// means no forecast.
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
  const prefix = last !== null && !nextPoints.length && !before.some(({ point }) => point);
  const reach = prefix ? growth(before, after) : null;
  const points = reach ? (reach.end === -1 ? [] : [reach.end]) : before.flatMap((message, index) => (message.point && caches(had[index]!) ? [index] : []));
  if (last && points.length) {
    const end = points.at(-1)!;
    const of = had[end]!;
    const none = (broken: CacheBreak): CacheForecast => ({ read: 0, of, broken });
    let same = 0;
    while (same < before.length && same < after.length && before[same]!.role === after[same]!.role && before[same]!.hash === after[same]!.hash) same++;
    // The grown chat and what is added after it are later conversation, not a change.
    found = changes(before, after, same, end).filter((change) => !reach || change.kind !== 'added' || change.at < reach.grown);
    const { print } = last;
    if (!last.live) against = none({ kind: 'expired' });
    else if (next.connection !== print.connection || next.model !== print.model) against = none({ kind: 'model' });
    else if (print.account !== null && next.account !== null && next.account !== print.account) against = none({ kind: 'account' });
    else if (JSON.stringify(next.reasoning) !== JSON.stringify(print.reasoning)) against = none({ kind: 'reasoning' });
    else if (reach) {
      readEnd = Math.min(same - 1, end);
      const read = readEnd === -1 ? 0 : upTo[readEnd]!;
      against = { read, of, broken: readEnd === end ? null : found[0] ? { kind: found[0].kind, from: found[0].from, role: found[0].role } : null };
    } else if (!nextPoints.length) against = none({ kind: 'off' });
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
  return { parts, removed, written: cached - read, tail: (upTo.at(-1) ?? 0) - cached, against, prefix };
}

// What the next send's input would cost as forecast, and had it read all the last call cached, from the model's
// price; null without one. Both write what the next send caches past what they read. ratio: the model's native tokens
// per o200k token (the send's calibrated centre), since the provider bills its own count and parts hold o200k.
export function breakCost(connection: Connection, model: Model, { parts, written, against, prefix }: Forecast, ratio: number): CacheBreakCost | null {
  if (!model.price || !against?.broken) return null;
  const native = (count: number) => Math.round(count * ratio);
  const inputTokens = native(parts.reduce((sum, { tokens }) => sum + tokens, 0));
  const unit = costUnit(resolveConnection(connection)?.type ?? null);
  const cost = (cached: number, write: number) => priceCost(model.price!, { inputTokens, outputTokens: 0, reasoningTokens: null, cachedInputTokens: native(cached), cacheWriteInputTokens: native(write) }, unit);
  const paid = cost(against.read, written);
  // A provider caching on its own bills what it writes as plain input, so neither side writes.
  const ends = prefix ? parts.reduce((sum, { tokens }) => sum + tokens, 0) : against.read + written;
  const whole = cost(Math.min(against.of, ends), prefix ? 0 : Math.max(ends - against.of, 0));
  return paid && whole && { paid, whole };
}
