import { priceCost } from '../connectors/pricing';
import type { Cost, Model } from '../connectors/types';
import type { PrereadPrompt } from '../model/prompt';
import type { PrereadParts, PrereadSettings } from '../model/settings';
import { fingerprint } from './memory';
import type { Assembled, From } from './pipeline';

// Preread replaces selected prompt parts with an auxiliary brief. Idea: Risu pdf-pod;
// instruction written independently without reading its prompts (user, 2026-10-19).
const INSTRUCTION = [
  'You prepare reading notes for another model, which will write the next reply in an ongoing story. It will not see the material you are given; it sees only your notes and the latest messages. Write notes that let it continue as if it had read everything.',
  '',
  'Keep, as facts and in the material\'s own words where wording matters:',
  '- the current scene: where and when it is, who is present, what just happened and what is about to;',
  '- every established fact that could matter later: names, relationships, promises, debts, secrets, injuries, belongings, numbers, places;',
  '- each character\'s manner of speaking and how they treat the others;',
  '- open threads and anything the user\'s character is in the middle of;',
  '- from system or world material, every rule, format requirement or instruction, quoted exactly.',
  '',
  'Leave out repetition, finished side episodes and description that no longer bears on the story.',
  '',
  'Do not continue the story, do not invent, do not judge the content, and do not address the reader. Write in the language of the material. Answer with the notes only.',
].join('\n');

// Keep the instruction in a separate leading system message so PDF packing contains material only.
export function prereadTaskPrompt(): PrereadPrompt {
  const named = (name: string | null = null) => ({ id: crypto.randomUUID(), name });
  return {
    task: 'preread',
    name: '기본 토큰 절약',
    toggles: [],
    blocks: [
      { ...named('토큰 절약 지시'), kind: 'text', role: 'system', text: INSTRUCTION, mark: null },
      { ...named(), kind: 'slot', slot: 'source', role: 'user', wrapper: null },
    ],
  };
}

export type PrereadPart = keyof PrereadParts;

// null: never shortened, the app's own instruction at the end. The memory slot and found records count as system: they
// are a summary already.
export function partOf(from: From): PrereadPart | null {
  switch (from.kind) {
    case 'block':
      return from.slot === 'chat' ? 'chat' : 'system';
    case 'lore':
    case 'depth':
      return 'lore';
    case 'retrieval':
    case 'script':
    case 'tool':
      return 'system';
    case 'continue':
    case 'answer':
    case 'preread':
    case 'agents':
      return null;
  }
}

const HEADINGS: Record<PrereadPart, string> = { chat: 'chat', system: 'system', lore: 'lorebook' };

// Stable identity: chat message id (greeting uses its first position), otherwise origin + occurrence.
// hash detects content edits; message retains the chat-message id.
export type Covered = { part: PrereadPart; key: string; hash: string; tokens: number; message?: string };

// taken: every message a brief may stand in for, in order, covered saying who each is. tokens: their o200k count.
export type PrereadPlan = { taken: number[]; covered: Covered[]; material: string; tokens: number };

function identities({ messages, parts }: Pick<Assembled, 'messages' | 'parts'>): (Covered | null)[] {
  const seen = new Map<string, number>();
  return messages.map(({ role, content }, at) => {
    const { from, tokens, origin } = parts[at]!;
    const part = partOf(from);
    if (!part) return null;
    const hash = fingerprint([{ role, text: content }]);
    if (part === 'chat') return { part, key: `chat:${origin ?? ''}`, hash, tokens, ...(origin !== undefined && { message: origin }) };
    const place = JSON.stringify(from);
    const count = seen.get(place) ?? 0;
    seen.set(place, count + 1);
    return { part, key: `${place}#${count}`, hash, tokens };
  });
}

// The latest recent chat messages and the latest user message stay as written. A message with pictures stays too: the
// brief is text, and its pictures would be lost.
export function prereadPlan(sent: Pick<Assembled, 'messages' | 'parts'>, { parts: chosen, recent }: Pick<PrereadSettings, 'parts' | 'recent'>): PrereadPlan | null {
  const { messages, parts } = sent;
  const chat = parts.flatMap(({ from }, at) => (from.kind === 'block' && from.slot === 'chat' ? [at] : []));
  const kept = new Set([...(recent > 0 ? chat.slice(-recent) : []), messages.findLastIndex(({ role }, at) => role === 'user' && partOf(parts[at]!.from) !== null)]);
  const who = identities(sent);
  const taken = messages.flatMap((message, at) => {
    const each = who[at];
    return each && chosen[each.part] && !kept.has(at) && !message.inlays ? [at] : [];
  });
  if (!taken.length) return null;
  const material = taken
    .map((at) => {
      const { role, content } = messages[at]!;
      const { part } = who[at]!;
      return `[${part === 'chat' ? `${HEADINGS.chat} · ${role}` : HEADINGS[part]}]\n${content}`;
    })
    .join('\n\n');
  return { taken, covered: taken.map((at) => who[at]!), material, tokens: taken.reduce((sum, at) => sum + parts[at]!.tokens, 0) };
}

const held = ({ key, hash }: Covered) => `${key}\n${hash}`;

// Changed/deleted covered chat/system content makes a brief stale. Budget-omitted messages are not deleted.
// Inactive lore is not stale either: keywords come and go, and retained facts are harmless.
// uncovered counts raw o200k tokens not replaced by the brief.
export function coverage(sent: Pick<Assembled, 'messages' | 'parts'>, plan: PrereadPlan, covered: readonly Covered[], present: ReadonlySet<string>): { replaced: number[]; uncovered: number; stale: boolean } {
  const now = new Map(identities(sent).flatMap((who) => (who ? [[who.key, who.hash] as const] : [])));
  const stale = covered.some(({ part, key, hash, message }) =>
    part === 'chat' ? (message !== undefined && !present.has(message)) || (now.has(key) && now.get(key) !== hash) : part === 'system' && now.get(key) !== hash,
  );
  const holds = new Set(covered.map(held));
  const replaced = plan.taken.filter((_, at) => holds.has(held(plan.covered[at]!)));
  const uncovered = plan.covered.reduce((sum, each) => (holds.has(held(each)) ? sum : sum + each.tokens), 0);
  return { replaced, uncovered, stale };
}

// One system message, the brief, where the first replaced message stood; everything left keeps its order.
export function placeBrief(sent: Assembled, replaced: readonly number[], brief: string, tokens: number): Assembled {
  const gone = new Set(replaced);
  const messages: Assembled['messages'] = [];
  const parts: Assembled['parts'] = [];
  sent.messages.forEach((message, at) => {
    if (at === replaced[0]) {
      messages.push({ role: 'system', content: brief });
      parts.push({ from: { kind: 'preread' }, tokens });
    }
    if (gone.has(at)) return;
    messages.push(message);
    parts.push(sent.parts[at]!);
  });
  return { ...sent, messages, parts };
}

// Savings use the chat input price minus the brief's call cost (zero when reused); longer briefs can save negatively.
// Unknown costs or unlike units yield null, never a fabricated total.
export function savedCost(taken: number, price: Model['price'], unit: Cost['unit'], spent: Cost | null): Cost | null {
  const input = price && priceCost(price, { inputTokens: Math.abs(taken), outputTokens: 0, reasoningTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null }, unit);
  if (!input || !spent || spent.unit !== unit) return null;
  return { unit, amount: Math.sign(taken) * input.amount - spent.amount, source: 'price-list' };
}
