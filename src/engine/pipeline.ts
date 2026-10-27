import type { CacheRender } from '../model/cache';
import type { TokenEstimate, TokenFit } from '../model/token-calibration';
import { cachePoints, type CachePart, type Sent } from './cache-points';
import { fitChat, messageTokens, remembered, type ChatSent, type ProviderFit, type Part, type TooLong } from './prompt-budget';
import { inlayIds, SIGNATURE, textFileNames } from './assets';
import type { ChatMessage } from '../connectors/types';
import type { Memory, Written } from '../model/memory';
import type { MascotId } from '../model/mascot';
import type { AgentPrompt, Block, IllustratePrompt, MascotPrompt, MemoryPrompt, PrereadPrompt, RecentSlot, Role, SlotKind, TextBlock, TranslatePrompt, WrappedSlot } from '../model/prompt';
import { unescapeCbs } from './cbs/escape';
import { evaluate, Runaway, type CbsContext, type CbsProblem, type CbsTrace } from './cbs/evaluate';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import { prepareLore, merge, type Activation, type Fired, type LoreBook, type LoreTurn, type Operation, type Silent } from './lorebook/activate';
import { authorNote, contexts, renderChat, type ChatScope } from './render';
import { chapterBefore, chapterFormat, memoryBefore, memoryBudget, memoryFormat, recordsTarget, spanText, speakersOf, standing, stateLimit, type MemoryInput, type MemorySent } from './memory';
import { retrieval, retrievalRoom } from './retrieval';
import { COMIC_PAGE, lastScene, numbered, profileNames, seenBy, severalScenes, type Earlier, type Told } from './illustrate';
import { mascotSheet } from './mascot';
import type { TranslationRequest } from './translate';
import { protect, protectRules, type ProtectInvalid } from './protect';
import { keepsMemory, memorySheet } from './agent';

export type PromptInput = {
  tools: { module: string; name: string; text: string }[];
  // prompt: null only on a request that keeps the prompt out (promptOut), which reads none of it.
  scope: ChatScope & { persona: NonNullable<ChatScope['persona']> };
  // Reply id: seeds random tags outside messages and lorebook probabilities.
  seed: string;
  countTokens: (text: string) => number;
  // Authored memory allowances stay in o200k. Only fit compares text with provider limits.
  budget: number | null;
  fit?: ProviderFit;
  // 이어 쓰기: the chat's messages end with the cut reply, and the continue instruction goes last.
  continuing: boolean;
  // Account instruction appended as a user message for new replies after assistant text (see CONTINUE).
  answerInstruction: string;
  // null while the chat's memory is off.
  memory: MemoryFill | null;
  // Pre-agent notes (engine/agent agentNotes).
  notes?: string;
  pictures: PictureSend;
};

// seen is model vision support; moved opts imported inlays into input (Chat.movedPictures).
export type PictureSend = { seen: boolean; moved: boolean };

// through indexes the last covered scope.messages entry; −1 means none (tool-owned memory, design §6.10).
export type MemoryFill = ({ kind: 'built-in' } & MemoryInput) | { kind: 'tool'; name: string; text: string; through: number };

// The CBS of some text the request is built from ran away (cbs/evaluate Runaway), and none of the request is sent.
export type RanAway = { kind: 'runaway' };

function stoppable<T>(build: () => T): T | RanAway {
  try {
    return build();
  } catch (error) {
    if (error instanceof Runaway) return { kind: 'runaway' };
    throw error;
  }
}

// A text written after the chat's messages, read with the variables they leave, as a prompt's text is (lay).
// source: a message's own when the text stands for that message, the only place setvar writes. language: what
// {{language}} reads, which only a translation's prompt sets. trace, when given, gets the steps, unescaped as the text is.
export const renderAfter = (scope: ChatScope, text: string, source: CbsContext['source'], language: string | null = null, trace: CbsTrace | null = null, variables?: ReadonlyMap<string, string>): string | RanAway =>
  stoppable(() => {
    const out = unescapeCbs(evaluate(text, contexts(scope, 'prompt', language, '', null)(source, new Map(variables ?? renderChat('prompt', scope).variables)), trace));
    for (const step of trace?.steps ?? []) step.result = unescapeCbs(step.result);
    return out;
  });

// slot is null for a text block. id: the prompt block's or the lore entry's, absent from a cache print or a receipt
// stored before it was kept.
export type From =
  | { kind: 'block'; id?: string; name: string | null; slot: SlotKind | null }
  | { kind: 'lore'; id?: string; name: string; slot: 'lorebook' | 'postEverything' }
  | { kind: 'depth'; id?: string; name: string; depth: number }
  | { kind: 'continue' }
  | { kind: 'answer' }
  | { kind: 'retrieval' }
  | { kind: 'script' }
  | { kind: 'tool'; name: string }
  // 토큰 절약's brief, in place of the parts it shortened (engine/preread).
  | { kind: 'preread' }
  // The pre agents' notes, after the chat, in a prompt with no 에이전트 노트 slot.
  | { kind: 'agents' };

export type Assembled = {
  messages: ChatMessage[];
  // One per message, in matching order; tokens use o200k_base, only an estimate for other tokenizers.
  parts: {
    from: From;
    tokens: number;
    origin?: string;
    // Chat/memory text before rendering; cbs records renders sent verbatim.
    source?: string;
    cbs?: CacheRender[];
  }[];
  // Names captured at activation; null when the chat has neither card nor lore.
  lore: (Fired & { name: string })[] | null;
  silent: (Silent & { name: string })[] | null;
  // Invalid regex keys never match, but remain reportable (design.md row 2).
  invalidKeys: { entry: string; name: string; key: string }[];
  loreBudget: number;
  // null while memory is off.
  memory: MemorySent | null;
  // Oldest messages omitted to fit the budget.
  dropped: number;
  problems: { found: Problem[]; omitted: number };
  // Uncovered input pictures omitted for a non-vision model; picture-only messages are omitted too.
  unseen: number;
};

// One per non-chat text; from may name an omitted part. Errors consumed by {{iserror}} do not count.
export type Problem = CbsProblem & { from: Extract<From, { kind: 'block' | 'lore' | 'depth' }> };
const MOST_PROBLEMS = 64;

// The app's own sentence, not a prompt's. A trailing user message rather than an assistant prefill, which current
// Claude models refuse with 400.
const CONTINUE = 'Your previous reply was cut off. Continue it exactly from where it stopped. Do not repeat anything already written.';

type Lore = { id: string; role: Role; body: string };

type Laid = {
  card: Card | null;
  cast: ChatScope['cast'];
  activation: Activation | null;
  lorebook: Lore[];
  last: Lore[];
  depths: (Lore & { depth: number })[];
  sides: { before: string[]; after: string[] };
  injections: Map<string, { body: string; operation: Operation }[]>;
  // cast: the id of the 등장인물 whose {{char}} the text reads; the chat's own otherwise.
  render: (text: string, place: string, cast?: string) => string;
  entry: (id: string, body: string) => string;
  named: (id: string) => string;
  // By the place of each text rendered through render or entry, as last rendered there; never a lore entry counted
  // only for activation.
  problems: Map<string, CbsProblem[]>;
  rendered: Map<string, CacheRender>;
};

function lay(scope: ChatScope, blocks: Block[], history: HistoryMessage[], variables: Map<string, string>, seed: string, tokens: (text: string) => number, language: string | null): Laid {
  const { card } = scope;
  const context = contexts(scope, 'prompt', language, '', null);
  const casts = new Map(scope.cast.map((member) => [member.id, contexts({ ...scope, card: member.card }, 'prompt', language, '', null)]));
  // Each text outside the chat's messages rolls its random tags anew for each request, apart from every other
  // text, and reads the variables as the chat's messages left them. The text last rendered at a place is kept, so
  // what is rendered there again is the same text and not a second roll.
  const held = new Map<string, { text: string; out: string; problems: CbsProblem[] }>();
  const rendered = (text: string, place: string, cast?: string) => {
    const last = held.get(place);
    if (last?.text === text) return last;
    const found: CbsProblem[] = [];
    const out = unescapeCbs(evaluate(text, { ...(cast === undefined ? context : casts.get(cast)!)({ seed: `${seed}:${place}` }, new Map(variables)), problems: found })).trim();
    const problems = [...new Map(found.filter(({ kind, text }) => kind === 'unknown-tag' || out.includes(text)).map((problem) => [`${problem.kind}:${problem.text}`, problem])).values()];
    const now = { text, out, problems };
    held.set(place, now);
    return now;
  };
  const render = (text: string, place: string, cast?: string) => rendered(text, place, cast).out;
  // A module's entries read the chat's {{char}}, as Risu's do; only a 등장인물's own read theirs.
  const owners = new Map(scope.lore.flatMap(({ id, parent }) => (parent !== null && casts.has(parent) ? [[id, parent] as const] : [])));
  // An entry costs what its body sends, so it is counted as rendered at its own place, where loreMessage sends it.
  // One merged into another entry or set inside another text is evaluated there, and its count is of its own body.
  // The replays below count the same bodies again.
  const count = (id: string, body: string) => tokens(render(body, id, owners.get(id)));
  const book = prepareLore(scope.lore, scope.loreScan);
  const activation = card || scope.lore.length > 0 ? book.activate(loreInput(scope, history, history.length, afterMatch(scope, book, count), seed, count, marksOf(blocks))) : null;
  const names = new Map(scope.lore.map(({ id, value }) => [id, value.name]));

  const lorebook: Lore[] = [];
  const last: Lore[] = [];
  const depths: (Lore & { depth: number })[] = [];
  const sides = { before: [] as string[], after: [] as string[] };
  const positions = new Map<string, string[]>();
  const injections = new Map<string, { body: string; operation: Operation }[]>();
  for (const { id, body, placement } of activation?.placed ?? []) {
    switch (placement.kind) {
      case 'lorebook':
        lorebook.push({ id, role: placement.role, body });
        break;
      case 'depth':
        if (placement.depth === 0) last.push({ id, role: placement.role, body });
        else depths.push({ id, role: placement.role, body, depth: placement.depth });
        break;
      case 'description':
        sides[placement.side].push(body);
        break;
      case 'position':
        add(positions, placement.name, body);
        break;
      case 'inject':
        add(injections, placement.target, { body, operation: placement.operation });
        break;
    }
  }

  const problems = new Map<string, CbsProblem[]>();
  const renders = new Map<string, CacheRender>();
  const placed = (text: string, place: string, cast?: string) => {
    const source = atPositions(text, positions);
    const now = rendered(source, place, cast);
    renders.set(place, { place, text: source, rendered: now.out, seed: `${seed}:${place}`, ...(cast !== undefined && { cast }) });
    problems.set(place, now.problems);
    return now.out;
  };
  return {
    card,
    cast: scope.cast,
    activation,
    lorebook,
    last,
    depths,
    sides,
    injections,
    render: placed,
    entry: (id, body) => placed(body, id, owners.get(id)),
    named: (id) => names.get(id)!,
    problems,
    rendered: renders,
  };
}

// In the order they were placed: what a bot's loadLoreBooks reads. An entry that renders to nothing is left out.
export const activeLore = (scope: ChatScope, seed: string, countTokens: (text: string) => number): { role: Role; text: string }[] | RanAway =>
  stoppable(() => placedLore(scope, seed, countTokens));

function placedLore(scope: ChatScope, seed: string, countTokens: (text: string) => number): { role: Role; text: string }[] {
  const laid = lay(scope, conversationBlocks(scope), scope.messages, renderChat('prompt', scope).variables, seed, remembered(countTokens), null);
  return (laid.activation?.placed ?? []).flatMap(({ id, body, placement }) => {
    const text = laid.entry(id, body);
    return text ? [{ role: 'role' in placement ? placement.role : 'system', text }] : [];
  });
}

type Filling =
  | { sort: 'conversation'; note: string; memory: string; tools: PromptInput['tools']; notes: string }
  | { sort: 'translate'; note: string; recent: (block: RecentSlot) => string; source: string }
  | { sort: 'illustrate'; note: string; recent: (block: RecentSlot) => string; source: string }
  | { sort: 'mascot'; recent: (block: RecentSlot) => string; source: string; sheet: string }
  | { sort: 'preread'; source: string }
  | { sort: 'agent'; recent: (block: RecentSlot) => string; source: string; memory: string }
  | { sort: 'memory'; memory: string; span: string };

const loreMessage = ({ entry }: Laid, { id, role, body }: Lore): ChatMessage => ({ role, content: entry(id, body) });
const loreFrom = (laid: Laid, { id }: Lore, slot: 'lorebook' | 'postEverything') => ({ kind: 'lore', id, name: laid.named(id), slot }) as const;
const depthFrom = (laid: Laid, { id, depth }: Lore & { depth: number }) => ({ kind: 'depth', id, name: laid.named(id), depth }) as const;
const throughSlot = (laid: Laid, entries: Lore[], slot: 'lorebook' | 'postEverything') => entries.map((entry): Sent => ({ message: loreMessage(laid, entry), from: loreFrom(laid, entry, slot) }));
const filled = (parts: Sent[]) => parts.filter(({ message }) => message.content !== '');

// A prompt's blocks in order, with its chat slots left open and every other block rendered once. memory: whether a
// 장기 기억 slot reaches the request, its 감싸는 텍스트 keeping {{slot}} once rendered, whether or not memory holds anything.
function templateOf(blocks: Block[], laid: Laid, persona: ChatScope['persona'], filling: Filling): { parts: Part[]; memory: boolean } {
  const { card, cast, render, sides, injections } = laid;
  const parts: Part[] = [];
  let memory = false;
  const out = (...sent: Sent[]) => parts.push(...filled(sent));
  // What a persona or a note holds is CBS of its own, evaluated inside its 감싸는 텍스트.
  const wrapped = (block: WrappedSlot, content: string) => {
    if (content.trim()) out({ message: { role: block.role, content: render(block.wrapper === null ? content : block.wrapper.replace('{{slot}}', () => content), block.id) }, from: blockFrom(block) });
  };
  // Text already rendered, or the user's own, is never evaluated again: only its 감싸는 텍스트 is. {{slot}} survives that
  // evaluation because the slot tag takes an argument (cbs/tags.ts), and one without it stays as written.
  const verbatim = (block: WrappedSlot, content: string, from: From = blockFrom(block)) => {
    const frame = block.wrapper === null ? '{{slot}}' : render(block.wrapper, block.id);
    const text = content.trim();
    if (text) out({ message: { role: block.role, content: frame.replace('{{slot}}', () => text) }, from });
    return frame.includes('{{slot}}');
  };
  for (const block of blocks) {
    if (block.kind === 'text') out({ message: { role: block.role, content: render(injected(ownText(block, card), block.mark === null ? [] : (injections.get(block.mark) ?? [])), block.id) }, from: blockFrom(block) });
    else
      switch (block.slot) {
        // Each character's text is evaluated as its own {{char}}, so the model never reads two characters as one.
        case 'description':
          verbatim(
            block,
            [
              render(joined([...sides.before, ...describe(card)]), `${block.id}:own`),
              ...cast.map(({ id, card: own }) => {
                const text = joined(describe(own));
                return text && render(`[{{char}}]\n${text}`, `${block.id}:${id}`, id);
              }),
              render(joined(sides.after), `${block.id}:after`),
            ]
              .filter((part) => part)
              .join('\n\n'),
          );
          break;
        case 'persona':
          wrapped(block, persona?.description ?? '');
          break;
        case 'authorNote':
          if (filling.sort === 'conversation') wrapped(block, filling.note);
          break;
        case 'lorebook':
          out(...throughSlot(laid, laid.lorebook, 'lorebook'));
          break;
        // 최종 삽입: where it stands, or at the very end when the prompt has none (assemble).
        case 'postEverything':
          out(...throughSlot(laid, laid.last, 'postEverything'));
          break;
        case 'chat':
          parts.push({ range: block.range, from: blockFrom(block) });
          break;
        case 'note':
          if (filling.sort === 'translate') wrapped(block, filling.note);
          break;
        case 'illustrateNote':
          if (filling.sort === 'illustrate') wrapped(block, filling.note);
          break;
        case 'recent':
          if (filling.sort === 'translate' || filling.sort === 'illustrate' || filling.sort === 'mascot' || filling.sort === 'agent') verbatim(block, filling.recent(block));
          break;
        case 'source':
          if (filling.sort === 'translate' || filling.sort === 'illustrate' || filling.sort === 'mascot' || filling.sort === 'preread' || filling.sort === 'agent') verbatim(block, filling.source);
          break;
        case 'memory':
          if (filling.sort === 'conversation' || filling.sort === 'memory') memory = verbatim(block, filling.memory);
          break;
        case 'tool':
          if (filling.sort === 'conversation') verbatim(block, joined(filling.tools.map(({ text }) => text)), toolFrom(filling.tools));
          break;
        case 'span':
          if (filling.sort === 'memory') verbatim(block, filling.span);
          break;
        case 'mascot':
          if (filling.sort === 'mascot') verbatim(block, filling.sheet);
          break;
        // A model wrote the notes, so they are never evaluated as CBS.
        case 'agentNotes':
          if (filling.sort === 'conversation') verbatim(block, filling.notes);
          break;
        case 'agentMemory':
          if (filling.sort === 'agent') verbatim(block, filling.memory);
          break;
      }
    if (block.cache) parts.push({ cache: true });
  }
  return { parts, memory };
}

// The messages memory covers leave the chat slots, though their variables are still replayed (renderChat renders them
// all) and the lorebook still scans them.
export const assemble = (input: PromptInput): Assembled | TooLong | RanAway => stoppable(() => conversation(input));

const toolFrom = (tools: PromptInput['tools']): From => ({ kind: 'tool', name: tools.filter(({ text }) => text.trim()).map(({ name }) => name).join(' · ') });

// The two empty texts still take the card's own system prompt and post-history instructions (ownText), which Risu's
// 유틸리티 봇 drops; the card's intent wins.
const UTILITY: Block[] = [
  { id: 'utility:main', name: null, kind: 'text', role: 'system', text: '', mark: 'main' },
  { id: 'utility:description', name: null, kind: 'slot', slot: 'description', role: 'system', wrapper: null },
  { id: 'utility:lorebook', name: null, kind: 'slot', slot: 'lorebook' },
  { id: 'utility:memory', name: null, kind: 'slot', slot: 'memory', role: 'system', wrapper: null },
  { id: 'utility:chat', name: null, kind: 'slot', slot: 'chat', range: { from: 0, to: null } },
  { id: 'utility:globalNote', name: null, kind: 'text', role: 'system', text: '', mark: 'globalNote' },
  { id: 'utility:postEverything', name: null, kind: 'slot', slot: 'postEverything' },
];
// A chat whose prompt is gone has no block for an @@inject_at entry to go into.
export const conversationBlocks = (scope: ChatScope) => (scope.promptOut ? UTILITY : (scope.prompt?.blocks ?? []));

function conversation({ scope, seed, countTokens, budget, fit, continuing, answerInstruction, memory, tools, notes = '', pictures }: PromptInput): Assembled | TooLong {
  const { prompt } = scope;
  const blocks = conversationBlocks(scope);
  const chat = renderChat('prompt', scope);
  if (chat.stopped) throw chat.stopped;
  const tokens = remembered(countTokens);
  const laid = lay(scope, blocks, scope.messages, chat.variables, seed, tokens, null);
  const { activation, named } = laid;
  const built = memory?.kind === 'built-in' ? memory : null;
  const read = built && { shown: built.shown, roles: scope.messages.map(({ role }) => role), speakers: speakersOf(scope), texts: chat.texts };
  const recalled = built && standing(built.memory, read!, memoryBudget(built.budget, budget), tokens);
  const told = memory?.kind === 'tool' ? memory : null;

  const { parts: template, memory: slot } = templateOf(blocks, laid, scope.persona, { sort: 'conversation', note: prompt ? authorNote(scope.note, prompt) : (scope.note ?? ''), memory: told?.text ?? recalled?.text ?? '', tools, notes });
  // Retrieval rides only where memory does, before the latest user message so it follows the last cache point.
  const found = built && slot ? retrieval(built.memory, built.found, recalled!, read!, retrievalRoom(memoryBudget(built.budget, budget)), tokens) : null;
  // A tool's text stands for its messages only where it reaches the request: without it there, none leave.
  const covered = told ? (slot && told.text.trim() ? told.through + 1 : 0) : (recalled?.covered ?? 0);
  const hasToolSlot = blocks.some((block) => block.kind === 'slot' && block.slot === 'tool');
  const toolText = joined(tools.map(({ text }) => text));
  const out = (...parts: Sent[]) => template.push(...filled(parts));
  if (!blocks.some((block) => block.kind === 'slot' && block.slot === 'postEverything')) out(...throughSlot(laid, laid.last, 'postEverything'));
  if (!hasToolSlot && toolText.trim()) out({ message: { role: 'system', content: toolText }, from: toolFrom(tools) });
  if (!blocks.some((block) => block.kind === 'slot' && block.slot === 'agentNotes') && notes.trim()) out({ message: { role: 'system', content: notes.trim() }, from: { kind: 'agents' } });
  if (continuing) out({ message: { role: 'user', content: CONTINUE }, from: { kind: 'continue' } });
  else if (scope.messages.at(-1)?.role === 'assistant') out({ message: { role: 'user', content: answerInstruction }, from: { kind: 'answer' } });

  // Read from each message's text as stored, since the prompt's rendering drops the tags (cbs/tags.ts).
  const sendable = new Map(scope.inlays.filter((inlay) => inlay.type !== SIGNATURE && (inlay.attached || pictures.moved)).map(({ name, id }) => [name, id]));
  const shownIn = ({ role, text }: HistoryMessage) => (role === 'user' ? inlayIds([text]).flatMap((name) => sendable.get(name) ?? []) : []);
  const unseen = pictures.seen ? 0 : scope.messages.slice(covered).reduce((count, message) => count + shownIn(message).length, 0);
  // A user message's text files go ahead of its text, each whole and named, as the file was: never through the bot's
  // regex or CBS, which would rewrite code.
  const files = new Map(scope.textfiles.map((file) => [file.name, file]));
  const filed = ({ role, text }: HistoryMessage) => (role === 'user' ? textFileNames(text).flatMap((name) => files.get(name) ?? []).map(({ title, text }) => `<file name="${title.replaceAll('"', "'")}">\n${text}\n</file>`) : []);
  const messages = chat.texts
    .slice(covered)
    .map((text, offset): ChatSent => {
      const at = covered + offset;
      const inlays = pictures.seen ? shownIn(scope.messages[at]!) : [];
      const content = [...filed(scope.messages[at]!), text.trim()].filter(Boolean).join('\n\n');
      const message = { role: scope.messages[at]!.role, content, ...(inlays.length > 0 && { inlays }) };
      // The greeting has none: Risu sends it as no message of its chat, and bots find it as the assistant message with
      // no memo.
      return at === 0 && scope.greeting !== null ? { message } : { message, origin: scope.messages[at]!.message };
    })
    .filter(({ message }) => message.content !== '' || message.inlays);
  const atDepth: { depth: number; sent: Sent }[] = laid.depths.map((entry) => ({ depth: entry.depth, sent: { message: loreMessage(laid, entry), from: depthFrom(laid, entry) } satisfies Sent })).filter(({ sent }) => sent.message.content !== '');
  const problems = problemsOf(laid, blocks);
  const lastUser = messages.findLastIndex(({ message }) => message.role === 'user');
  const retrieved = found && lastUser !== -1 ? found : null;
  if (retrieved) atDepth.push({ depth: messages.length - lastUser, sent: { message: { role: 'user', content: retrieved.text }, from: { kind: 'retrieval' } } });
  const sources = new Map(scope.messages.map(({ message, text }) => [message, text]));
  const assembled = (parts: (Sent | CachePart)[], dropped: number): Assembled => {
    const sent = cachePoints(parts);
    return {
      messages: sent.map(({ message }) => message),
      parts: sent.map(({ message, from, origin }) => {
        const id = 'id' in from ? from.id : undefined;
        const cbs = id ? [...laid.rendered.values()].filter(({ place, rendered }) => (place === id || place.startsWith(`${id}:`)) && rendered && message.content.includes(rendered)) : [];
        const source = from.kind === 'block' && from.slot === 'chat' ? origin === undefined ? undefined : sources.get(origin) : from.kind === 'block' && from.slot === 'memory' ? told?.text ?? recalled?.text : undefined;
        return { from, tokens: messageTokens(tokens, message), ...(origin !== undefined && { origin }), ...(source !== undefined && { source }), ...(cbs.length > 0 && { cbs }) };
      }),
      lore: activation && activation.fired.map((fired) => ({ ...fired, name: named(fired.id) })),
      silent: activation && activation.silent.map((silent) => ({ ...silent, name: named(silent.id) })),
      invalidKeys: activation ? activation.invalidKeys.map((invalid) => ({ ...invalid, name: named(invalid.entry) })) : [],
      loreBudget: scope.loreScan.tokenBudget,
      memory: told ? { by: told.name, text: told.text, covered, missing: 0, slot } : recalled && { by: null, sent: recalled.sent, found: retrieved?.ids ?? [], covered, missing: slot ? covered - recalled.held : covered, slot },
      dropped,
      problems,
      unseen,
    };
  };

  // The rest of the template stays whole.
  const fitted = fitChat(template, messages, atDepth, tokens, fit ?? null);
  return 'kind' in fitted ? fitted : assembled(fitted.parts, fitted.dropped);
}

// A block's description renders at places under its own id (templateOf); an entry's at its id.
function problemsOf(laid: Laid, blocks: Block[]): Assembled['problems'] {
  const entries = new Map<string, Problem['from']>([
    ...laid.lorebook.map((entry) => [entry.id, loreFrom(laid, entry, 'lorebook')] as const),
    ...laid.last.map((entry) => [entry.id, loreFrom(laid, entry, 'postEverything')] as const),
    ...laid.depths.map((entry) => [entry.id, depthFrom(laid, entry)] as const),
  ]);
  const all = [...laid.problems].flatMap(([place, found]) => {
    const from = entries.get(place) ?? blockFrom(blocks.find(({ id }) => place === id || place.startsWith(`${id}:`))!);
    return found.map((problem): Problem => ({ ...problem, from }));
  });
  return { found: all.slice(0, MOST_PROBLEMS), omitted: Math.max(all.length - MOST_PROBLEMS, 0) };
}

// How much of each message before the source 앞 메시지 holds, from its end.
const TAIL_CHARS = 1500;

export type TranslationInput = {
  // The chat's, its messages as shown.
  scope: ChatScope;
  // The display scripts that draw the status window (상태창 지정), whose boxes a message's source leaves out.
  take: ReadonlySet<number>;
  prompt: TranslatePrompt;
  translations: (string | null)[];
  // 번역가의 노트, 전역 then the character's, already joined; empty for none.
  notes: string;
  request: TranslationRequest;
  // What {{language}} reads: the language translated into.
  language: string;
  seed: string;
  countTokens: (text: string) => number;
};

// Translate displayed message text (post-CBS/display scripts) or typed input, never stored message text.
// No chat means depth/card-replacement lore has no destination. spans masks protected source and must round-trip;
// no source slot means no spans.
export const assembleTranslation = (input: TranslationInput): { source: string; messages: ChatMessage[]; spans: string[] } | ProtectInvalid | RanAway => stoppable(() => translation(input));

// A message whose CBS ran away is its source as shown, tags as written, and the display says so.
function translation({ scope, take, prompt, translations, notes, request, language, seed, countTokens }: TranslationInput): { source: string; messages: ChatMessage[]; spans: string[] } | ProtectInvalid {
  const rules = protectRules(prompt.protect ?? []);
  if ('kind' in rules) return rules;
  const { texts, variables } = renderChat('display', scope, take);
  const before = request.kind === 'message' ? request.index : texts.length;
  const { masked: source, spans } = protect(request.kind === 'message' ? texts[request.index]! : request.text, rules);
  const history = request.kind === 'message' ? scope.messages.slice(0, request.index + 1) : [...scope.messages, { id: seed, message: seed, seed, role: 'user' as const, text: request.text, time: null }];
  const laid = lay(scope, prompt.blocks, history, variables, seed, remembered(countTokens), language);
  const { parts } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'translate', note: notes, recent: recentOf(scope, texts, before, translations), source });
  const sent = parts.find((part): part is Sent => 'message' in part && part.from.kind === 'block' && part.from.slot === 'source');
  if (!sent) return { source, messages: taskMessages(parts), spans: [] };
  if (spans.length) parts.splice(parts.indexOf(sent), 0, { message: { role: 'system', content: keepTokens(spans.length) }, from: sent.from });
  return { source, messages: taskMessages(parts), spans };
}

const keepTokens = (count: number) =>
  `Tokens like ⟦1⟧ stand for parts of the source kept out of the translation; it holds ${count}, ⟦1⟧ to ⟦${count}⟧. Keep every token exactly as written, in its place; never translate, drop, change or add one.`;

const keepEditTokens = (count: number) =>
  `Tokens like ⟦1⟧ stand for parts of the reply kept out of the edit; it holds ${count}, ⟦1⟧ to ⟦${count}⟧. Keep every token exactly as written, in its place; never drop, change or add one.`;

// 이전 메시지: the messages before the one at before, as displayed, each with its translation unless the slot holds none.
const recentOf = (scope: ChatScope, texts: string[], before: number, translations: (string | null)[]) => ({ count, translations: withTranslations }: RecentSlot) => {
  const from = Math.max(before - count, 0);
  const speakers = speakersOf(scope);
  return texts
    .slice(from, before)
    .map((text, offset) => {
      const at = from + offset;
      const translation = withTranslations === false ? null : translations[at];
      return [`[${speakers[at]}]`, text.slice(-TAIL_CHARS), ...(translation ? ['Its translation:', translation.slice(-TAIL_CHARS)] : [])].join('\n');
    })
    .join('\n\n');
};

export type IllustrationInput = {
  // The chat's, its messages as shown, up to the one illustrated.
  scope: ChatScope;
  take: ReadonlySet<number>;
  prompt: IllustratePrompt;
  // The illustrated message's place in scope.messages, and its stored text's paragraphs (model/illustration
  // paragraphsOf), which the scene names by number.
  index: number;
  paragraphs: string[];
  count: number;
  // The portraits the pictures are drawn with (runtime/likeness).
  portraits: Told[];
  // The chat's 삽화 노트, '' for none.
  note: string;
  // The chat's latest picture before this call, null for none.
  last: Earlier | null;
  // The name of the persona the picture is seen through, null when not drawn from the persona's eyes.
  pov: string | null;
  comic: boolean;
  seed: string;
  countTokens: (text: string) => number;
};

// Like a translation, a 삽화 task holds no chat, so entries placed at a depth are not sent in it.
export const assembleIllustration = (input: IllustrationInput): { messages: ChatMessage[] } | RanAway => stoppable(() => illustration(input));

function illustration({ scope, take, prompt, index, paragraphs, count, portraits, note, last, pov, comic, seed, countTokens }: IllustrationInput): { messages: ChatMessage[] } {
  const { texts, variables } = renderChat('display', scope, take);
  const laid = lay(scope, prompt.blocks, scope.messages.slice(0, index + 1), variables, seed, remembered(countTokens), null);
  const { parts } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'illustrate', note, recent: recentOf(scope, texts, index, []), source: numbered(paragraphs) });
  const asked = [
    ...(portraits.length ? [profileNames(portraits)] : []),
    ...(last ? [lastScene(last)] : []),
    ...(pov === null ? [] : [seenBy(pov)]),
    ...(comic ? [COMIC_PAGE] : []),
    ...(count > 1 ? [severalScenes(count)] : []),
  ];
  return { messages: [...taskMessages(parts), ...asked.map((content) => ({ role: 'user' as const, content }))] };
}

export type MascotInput = {
  // The chat's, its messages as shown, up to the reply.
  scope: ChatScope;
  take: ReadonlySet<number>;
  prompt: MascotPrompt;
  // The reply's place in scope.messages.
  index: number;
  mascot: MascotId;
  // The mascot's last lines in the chat, oldest first (engine/mascot mascotSheet).
  said: string[];
  seed: string;
  countTokens: (text: string) => number;
};

// Like a translation, a 마스코트 task holds no chat, and its source is the reply as displayed.
export const assembleMascot = (input: MascotInput): { messages: ChatMessage[] } | RanAway => stoppable(() => remark(input));

function remark({ scope, take, prompt, index, mascot, said, seed, countTokens }: MascotInput): { messages: ChatMessage[] } {
  const { texts, variables } = renderChat('display', scope, take);
  const laid = lay(scope, prompt.blocks, scope.messages.slice(0, index + 1), variables, seed, remembered(countTokens), null);
  const { parts } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'mascot', recent: recentOf(scope, texts, index, []), source: texts[index]!, sheet: mascotSheet(mascot, said) });
  return { messages: taskMessages(parts) };
}

export type PrereadInput = {
  // The chat's, as the request being shortened was built from it.
  scope: ChatScope;
  prompt: PrereadPrompt;
  // What the 보조 model reads (engine/preread prereadPlan).
  material: string;
  seed: string;
  countTokens: (text: string) => number;
};

// The material is the request's own text, already rendered, so it goes into the source slot as it is.
export const assemblePreread = (input: PrereadInput): { messages: ChatMessage[] } | RanAway => stoppable(() => preread(input));

function preread({ scope, prompt, material, seed, countTokens }: PrereadInput): { messages: ChatMessage[] } {
  const { variables, stopped } = renderChat('prompt', scope);
  if (stopped) throw stopped;
  const laid = lay(scope, prompt.blocks, scope.messages, variables, seed, remembered(countTokens), null);
  return { messages: taskMessages(templateOf(prompt.blocks, laid, scope.persona, { sort: 'preread', source: material }).parts) };
}

export type AgentInput = {
  // The chat's, its messages up to the source, as a request sends them.
  scope: ChatScope;
  prompt: AgentPrompt;
  // The source's place in scope.messages: for a pre agent the message the reply answers, for a post agent the reply.
  index: number;
  // A post agent's: the reply as the agent before it left it, the stored text for the first. Absent for a pre agent,
  // whose source is the message as sent. Only one that rewrites the reply gets it masked by its 보호 패턴.
  text?: string;
  // The agent's memory as it stands (runtime/agents memoryOf), '' for none yet.
  memory: string;
  seed: string;
  countTokens: (text: string) => number;
};

// spans: what the tokens in a post agent's source stand for (engine/protect), which its answer must bring back.
// parts: where each message came from, as a reply's Assembled says it (점검's 블록별).
export const assembleAgent = (input: AgentInput): { messages: ChatMessage[]; parts: Assembled['parts']; spans: string[] } | ProtectInvalid | RanAway => stoppable(() => agent(input));

function agent({ scope, prompt, index, text, memory, seed, countTokens }: AgentInput): { messages: ChatMessage[]; parts: Assembled['parts']; spans: string[] } | ProtectInvalid {
  const rewrites = text !== undefined && prompt.place === undefined;
  const rules = protectRules(rewrites ? (prompt.protect ?? []) : []);
  if ('kind' in rules) return rules;
  const { texts, variables, stopped } = renderChat('prompt', scope);
  if (stopped) throw stopped;
  const { masked: source, spans } = rewrites ? protect(text, rules) : { masked: text ?? texts[index] ?? '', spans: [] };
  const laid = lay(scope, prompt.blocks, scope.messages.slice(0, index + 1), variables, seed, remembered(countTokens), null);
  const { parts } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'agent', recent: recentOf(scope, texts, index, []), source, memory: keepsMemory(prompt) ? memorySheet(memory) : '' });
  const sent = parts.find((part): part is Sent => 'message' in part && part.from.kind === 'block' && part.from.slot === 'source');
  if (sent && spans.length) parts.splice(parts.indexOf(sent), 0, { message: { role: 'system', content: keepEditTokens(spans.length) }, from: sent.from });
  const out = taskSent(parts);
  return { messages: out.map(({ message }) => message), parts: out.map(({ message, from }) => ({ from, tokens: countTokens(message.content) })), spans: sent ? spans : [] };
}

export type MemoryTaskInput = {
  // The chat's, its messages as a request sends them.
  scope: ChatScope;
  prompt: MemoryPrompt;
  memory: Memory;
  // The chapter just before a chapter's messages, else the record just before the messages.
  before: Written | null;
  // The chat's memory-slot budget; state takes a share of it.
  budget: number;
  // The messages summarized, by place in scope.messages, from included and to not.
  span: { from: number; to: number };
  // A chapter's job, with its length in tokens; null for records.
  chapter: { target: number } | null;
  seed: string;
  countTokens: (text: string) => number;
};

// span: the span's texts as the prompt renders them, variables replayed, which the answer is validated against and
// the records' fingerprints are made of. Like a translation, a memory task holds no chat, so entries placed at a
// depth are not sent in it.
export const assembleMemory = (input: MemoryTaskInput): { messages: ChatMessage[]; span: string[] } | RanAway => stoppable(() => memoryTask(input));

function memoryTask({ scope, prompt, memory, before, budget, span: { from, to }, chapter, seed, countTokens }: MemoryTaskInput): { messages: ChatMessage[]; span: string[] } {
  const { texts, variables, stopped } = renderChat('prompt', scope);
  if (stopped) throw stopped;
  const laid = lay(scope, prompt.blocks, scope.messages.slice(0, to), variables, seed, remembered(countTokens), null);
  const speakers = speakersOf(scope);
  const span = texts.slice(from, to);
  const shown = spanText(span.map((text, offset) => ({ speaker: speakers[from + offset]!, text: text.trim() })));
  const held = chapter ? chapterBefore(before) : memoryBefore(memory, before, stateLimit(budget), countTokens);
  const { parts } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'memory', memory: held, span: shown });
  const messages = taskMessages(parts);
  const format = chapter ? chapterFormat(to - from, chapter.target) : memoryFormat(to - from, recordsTarget(span.reduce((sum, text) => sum + countTokens(text), 0), budget));
  return { messages: [...messages, { role: 'user', content: format }], span };
}

const taskSent = (parts: Part[]) => cachePoints(parts.filter((part): part is Sent | CachePart => !('range' in part)));

function taskMessages(parts: Part[]): ChatMessage[] {
  return taskSent(parts).map(({ message }) => message);
}

function add<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

const blockFrom = (block: Block): Extract<From, { kind: 'block' }> => ({ kind: 'block', id: block.id, name: block.name, slot: block.kind === 'slot' ? block.slot : null });

// end: where the reply being written stands in history, which holds the greeting first when the chat has one.
function loreInput(scope: ChatScope, history: HistoryMessage[], end: number, afterMatch: string[], seed: string, cost: LoreTurn['cost'], marks: LoreTurn['marks']): LoreTurn {
  return { history: history.slice(scope.greeting === null ? 0 : 1, end), greeting: scope.greeting && scope.greeting.index, afterMatch, seed, cost, marks };
}

const marksOf = (blocks: Block[]) => new Set(blocks.flatMap((block) => (block.kind === 'text' && block.mark !== null ? [block.mark] : [])));

// Which after-match entries went into the prompts of the replies before this one. It is not stored: like the
// variables, it is replayed from the chat, each earlier reply's activation rolled again from its seed.
function afterMatch(scope: ChatScope, book: LoreBook, cost: LoreTurn['cost']): string[] {
  let state: string[] = [];
  if (!book.sticky) return state;
  const marks = marksOf(conversationBlocks(scope));
  scope.messages.forEach((message, index) => {
    if (message.role === 'user' || (index === 0 && scope.greeting !== null)) return;
    state = book.activate(loreInput(scope, scope.messages, index, state, message.seed, cost, marks)).afterMatch;
  });
  return state;
}

// The main text and the global note are the ones a card replaces, with {{original}} for the prompt's own.
function ownText({ text, mark }: TextBlock, card: Card | null): string {
  const replacement = mark === 'main' ? card?.systemPrompt : mark === 'globalNote' ? card?.postHistoryInstructions : undefined;
  return replacement?.trim() ? replacement.replaceAll('{{original}}', () => text) : text;
}

// @@inject_at names a text block by its mark, main or globalNote. Risu's other targets (normal, jailbreak, cot, a slot's
// 감싸는 텍스트) have no block here, so activation drops the entries naming them (marksOf).
function injected(text: string, injections: { body: string; operation: Operation }[]): string {
  return injections.reduce((target, { body, operation }) => merge(target, body, operation) ?? target, text);
}

// {{position::name}} holds the entries placed there, a line each, and what they hold nests up to five deep
// (risu-compat-spec §e); a name no entry went to holds nothing.
const POSITION = /\{\{position::([^{}]*)\}\}/g;
function atPositions(text: string, positions: Map<string, string[]>): string {
  let out = text;
  for (let level = 0; level < 5; level++) {
    const next = out.replace(POSITION, (_, name: string) => positions.get(name)?.join('\n') ?? '');
    if (next === out) break;
    out = next;
  }
  return out;
}

const joined = (parts: string[]) => parts.filter((part) => part.trim()).join('\n\n');

// Example dialogue has no slot of its own, so it goes here.
function describe(card: Card | null): string[] {
  if (!card) return [];
  return [
    card.description,
    card.personality && `{{char}}'s personality: ${card.personality}`,
    card.scenario && `Scenario: ${card.scenario}`,
    card.exampleDialogue && `Example dialogue:\n${card.exampleDialogue}`,
  ];
}

export type Unused = { kind: 'bias'; count: number };

export function unused(card: Card): Unused[] {
  const found: Unused[] = [{ kind: 'bias', count: card.bias.length }];
  return found.filter((item) => item.count > 0);
}

// Whether a conversation prompt sends the persona's description: by its 페르소나 slot, or by the tag written in a block
// under any spelling cbs/tags.ts normalizes to persona or userpersona. A request that keeps the prompt out has no persona (UTILITY).
const PERSONA_TAG = /\{\{[\s_-]*(?:user[\s_-]*)?persona[\s_-]*\}\}/i;
export const holdsPersona = (blocks: Block[]) =>
  blocks.some((block) => (block.kind === 'text' ? PERSONA_TAG.test(block.text) : block.slot === 'persona' || ('wrapper' in block && block.wrapper !== null && PERSONA_TAG.test(block.wrapper))));

export type TokenSource = From | { kind: 'description' | 'persona' | 'memory' | 'chat' | 'lorebook' };
export type TokenGroup = { source: TokenSource; tokens: number; count: number };
export type TokenGroups = { groups: TokenGroup[]; total: number; fit: TokenFit; estimate: TokenEstimate; dropped: number };

export function tokenGroups(prompt: Pick<Assembled, 'parts' | 'dropped'>, snapshot: Pick<TokenGroups, 'fit' | 'estimate'>): TokenGroups {
  const groups = new Map<string, TokenGroup>();
  let total = 0;
  for (const { from, tokens } of prompt.parts) {
    const source: TokenSource = from.kind === 'block' && (from.slot === 'description' || from.slot === 'persona' || from.slot === 'memory' || from.slot === 'chat')
      ? { kind: from.slot }
      : from.kind === 'lore' ? { kind: 'lorebook' } : from;
    const key = JSON.stringify(source);
    const group = groups.get(key) ?? { source, tokens: 0, count: 0 };
    group.tokens += tokens;
    group.count++;
    total += tokens;
    groups.set(key, group);
  }
  return { groups: [...groups.values()], total, fit: snapshot.fit, estimate: snapshot.estimate, dropped: prompt.dropped };
}
