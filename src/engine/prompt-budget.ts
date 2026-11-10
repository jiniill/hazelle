import type { ChatMessage, Model } from '../connectors/types';
import type { ModelSettings } from '../connectors/settings';
import { prepareChat } from '../connectors/preparation';
import { requestRoute, type WireRoute } from '../connectors/registry';
import type { ChatRange } from '../model/prompt';
import { cachePoints, type CachePart, type Sent } from './cache-points';
import type { Assembled, From } from './pipeline';

// Even the last message alone leaves the prompt over its budget.
export type TooLong = { kind: 'too-long'; tokens: number; budget: number };

type ChatPart = { range: ChatRange; from: From };
export type Part = Sent | ChatPart | CachePart;

export type ProviderFit = { allowance: number | null; route: WireRoute; model: Model; settings: ModelSettings };

// What a picture is budgeted at, whatever its size: Anthropic's ~1.15 megapixels over 750, the dearest of the codecs, which
// runtime/files/picture never sends past.
export const PICTURE_TOKENS = 1600;
const pictureTokens = (message: ChatMessage) => (message.inlays?.length ?? 0) * PICTURE_TOKENS;
export const messageTokens = (countTokens: (text: string) => number, message: ChatMessage) => countTokens(message.content) + pictureTokens(message);

export function wireTokens(fit: ProviderFit, messages: ChatMessage[], countTokens: (text: string) => number): number {
  const prepared = prepareChat(requestRoute(fit.route), { model: fit.model, settings: fit.settings, messages });
  return prepared.wire.segments.reduce((total, { text }) => total + countTokens(text), 0) + messages.reduce((total, message) => total + pictureTokens(message), 0);
}

export type ChatSent = Omit<Sent, 'from'>;

export function fitChat(template: Part[], messages: ChatSent[], depths: { depth: number; sent: Sent }[], countTokens: (text: string) => number, fit: ProviderFit | null): { parts: (Sent | CachePart)[]; dropped: number } | TooLong {
  const tokens = remembered(countTokens);
  const partsAt = (dropped: number) => {
    const kept = messages.slice(dropped);
    // An entry at @@depth N goes before the message N from the end, wherever that message is; at 0, after the last.
    const before = new Map<number, Sent[]>();
    for (const { depth, sent } of depths) {
      const at = Math.max(kept.length - depth, 0);
      const entries = before.get(at);
      if (entries) entries.push(sent);
      else before.set(at, [sent]);
    }
    return template.flatMap((part) => ('range' in part ? range(kept, before, part) : [part]));
  };
  const dropped = fit?.allowance == null ? 0 : dropOldest(fit.allowance, messages.length, budgetSize(template, messages, depths, tokens), (cut) => wireTokens(fit, cachePoints(partsAt(cut)).map(({ message }) => message), tokens));
  return typeof dropped === 'number' ? { parts: partsAt(dropped), dropped } : dropped;
}

// The budget drops the oldest chat messages first and never the last one; what does not fit even then is not sent.
// size: the request's tokens with the oldest of its count chat messages dropped. Gives how many to drop.
// size may only be called with non-decreasing dropped; budgetSize advances its windows in place.
// Signed and overlapping ranges need not shrink monotonically: search cuts in order.
function dropOldest(budget: number, count: number, size: (dropped: number) => number, measure: (dropped: number) => number): number | TooLong {
  const last = Math.max(0, count - 1);
  let dropped = 0;
  let plain = size(dropped);
  let tokens = measure(dropped);
  // All codecs preserve body text parts, including Gemini's same-role merges. Only system joins/cache splits
  // change the sum: unchanged system segments mean zero overhead variation, so start + chosen cut suffice.
  // Depth/range changes can replace whole system texts, not just separators: no universal per-cut token bound
  // exists. Allow one recalibration, then check the last legal cut. At most four full builds, even for tiny
  // messages or nonmonotone ranges; this rare fallback may retain less history, but never skips the wire check.
  for (let check = 1; tokens > budget; check++) {
    if (dropped === last) return { kind: 'too-long', tokens, budget };
    const overhead = tokens - plain;
    if (check === 3) dropped = last;
    else {
      do { plain = size(++dropped); } while (plain + overhead > budget && dropped < last);
    }
    plain = size(dropped);
    tokens = measure(dropped);
  }
  return dropped;
}

// A message the script left as built keeps its part, any other is the script's and counted here. The budget holds
// for this request as it does in assemble, over the chat messages left as built.
export function rewritten(prompt: Assembled, messages: ChatMessage[], countTokens: (text: string) => number, fit: ProviderFit | null): Assembled | TooLong {
  const tokens = remembered(countTokens);
  let next = 0;
  const sent = messages.map((message) => {
    let at = next;
    while (at < prompt.messages.length && (prompt.messages[at]!.role !== message.role || prompt.messages[at]!.content !== message.content)) at++;
    if (at === prompt.messages.length) return { message, from: { kind: 'script' } satisfies From, tokens: messageTokens(tokens, message) };
    next = at + 1;
    return { message, ...prompt.parts[at]! };
  });
  const chat = sent.flatMap(({ from }, at) => (from.kind === 'block' && from.slot === 'chat' ? [at] : []));
  const total = sent.reduce((sum, { tokens }) => sum + tokens, 0);
  const before = [0];
  for (const at of chat) before.push(before.at(-1)! + sent[at]!.tokens);
  const candidate = (dropped: number) => {
    const gone = new Set(chat.slice(0, dropped));
    return sent.filter((_, at) => !gone.has(at));
  };
  const dropped = fit?.allowance == null ? 0 : dropOldest(fit.allowance, chat.length, (cut) => total - before[cut]!, (cut) => wireTokens(fit, candidate(cut).map(({ message }) => message), tokens));
  if (typeof dropped !== 'number') return dropped;
  const gone = new Set(chat.slice(0, dropped));
  const kept = sent.filter((_, at) => !gone.has(at));
  return { ...prompt, messages: kept.map(({ message }) => message), parts: kept.map(({ from, tokens, origin, source, cbs }) => ({ from, tokens, ...(origin !== undefined && { origin }), ...(source !== undefined && { source }), ...(cbs && { cbs }) })), dropped: prompt.dropped + dropped };
}

function range(kept: ChatSent[], before: Map<number, Sent[]>, { range: { from, to }, from: slot }: ChatPart): Sent[] {
  const [start, end] = rangeBounds(kept.length, { from, to });
  const out: Sent[] = [];
  for (let index = start; index < end; index++) out.push(...(before.get(index) ?? []), { ...kept[index]!, from: slot });
  if (end === kept.length) out.push(...(before.get(end) ?? []));
  return out;
}

function rangeBounds(length: number, { from, to }: ChatRange): [number, number] {
  const at = (n: number) => (n < 0 ? Math.max(length + n, 0) : Math.min(n, length));
  return [at(from), to === null ? length : at(to)];
}

export function remembered(countTokens: (text: string) => number): (text: string) => number {
  const counts = new Map<string, number>();
  return (text) => {
    let count = counts.get(text);
    if (count === undefined) { count = countTokens(text); counts.set(text, count); }
    return count;
  };
}

function budgetSize(template: Part[], messages: ChatSent[], depths: { depth: number; sent: Sent }[], tokens: (text: string) => number): (dropped: number) => number {
  const ranges = template.filter((part): part is ChatPart => 'range' in part).map(({ range }) => ({ range, start: 0, end: 0, tokens: 0 }));
  const fixed = template.reduce((sum, part) => sum + ('message' in part ? tokens(part.message.content) : 0), 0);
  const ordered = [...depths].sort((a, b) => a.depth - b.depth);
  const depthPrefix = [0];
  for (const { sent } of ordered) depthPrefix.push(depthPrefix.at(-1)! + tokens(sent.message.content));
  const throughDepth = (depth: number) => {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ordered[middle]!.depth <= depth) low = middle + 1;
      else high = middle;
    }
    return depthPrefix[low]!;
  };
  return (dropped) => {
    const length = messages.length - dropped;
    let size = fixed;
    for (const held of ranges) {
      const [start, end] = rangeBounds(length, held.range);
      const absoluteStart = dropped + start;
      const absoluteEnd = dropped + Math.max(start, end);
      // dropOldest advances cuts in order: both absolute bounds only advance. Each text enters/leaves a slot
      // at most once; nothing outside the tried ranges is tokenized, including when no trimming is needed.
      // Costs themselves need not be monotone: overlapping signed ranges can gain messages as cuts advance.
      for (let at = held.start; at < Math.min(absoluteStart, held.end); at++) held.tokens -= messageTokens(tokens, messages[at]!.message);
      for (let at = Math.max(held.end, absoluteStart); at < absoluteEnd; at++) held.tokens += messageTokens(tokens, messages[at]!.message);
      held.start = absoluteStart;
      held.end = absoluteEnd;
      if (end <= start) continue;
      size += held.tokens;
      // Depths beyond the remaining history clamp to its first message, not outside the slot.
      size += (start === 0 ? depthPrefix.at(-1)! : throughDepth(length - start)) - throughDepth(length - end);
    }
    return size;
  };
}

