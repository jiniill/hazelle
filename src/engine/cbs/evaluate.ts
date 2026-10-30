import type { BotAsset } from '../assets';
import type { HistoryMessage } from '../history';
import type { Card, LoreEntry } from '../import/types';
import { seeded } from '../random';
import type { Stage } from '../render';
import { escapeCbs } from './escape';
import type { PreviousMessages } from './history';
import { parse, type Block, type Legacy, type Node, type Tag } from './parse';
import { bool, handlerFor, isErrorText, isUnsupportedTag, items, normalize, readToggle, readVar, Return, truthy, type Env, type Erase } from './tags';

// unknown-tag: a tag or block no handler takes, as written back, unless its name is prose. error-text: Risu's error text a tag gave ({{iserror}}).
export type CbsProblem = { kind: 'unknown-tag' | 'error-text'; text: string };

export type CbsContext = {
  stage: Stage;
  card: Card | null;
  // With none, the account's username and no description.
  persona: { name: string; description: string } | null;
  // The prompt's own main text and global note, not a card's replacements, and the author's note in effect.
  // persona and prompt are null when the chat's is gone, which only the display renders through.
  prompt: { main: string; globalNote: string; authorNote: string } | null;
  lore: readonly Omit<LoreEntry, 'folder'>[];
  messages: HistoryMessage[];
  previous: PreviousMessages;
  // Message indices use that message's seed and allow chat-variable writes; other text uses a per-request seed and cannot.
  source: { message: number } | { seed: string };
  // Opening greeting at messages[0]; null if none. index is null when the shown version no longer matches the card.
  greeting: { index: number | null } | null;
  // The chat's variables as of this text, written in place, replayed over the card's defaults in message order.
  variables: Map<string, string>;
  // null when nothing declares the toggle.
  toggle: (key: string) => string | null;
  // prefill: whether the model takes an assistant prefill, as its connection says; never read from the id.
  // null when unknown, and model null when the chat has no model.
  model: { id: string; maxContext: number | null; prefill: boolean | null } | null;
  // The 보조 모델's id, as {{axmodel}} reads it; null when the chat resolves none.
  axModel: string | null;
  // Pressed element's risu-id; '' outside a trigger or when the element has none.
  triggerId: string;
  // The window's size, as Risu reads window.innerWidth: null in the prompt, and when the display does not know it.
  screen: { width: number; height: number } | null;
  // now in ms since the epoch; timeZone an IANA name, since the engine reads no zone of the device it runs on.
  clock: { now: number; timeZone: string };
  // The language a translation prompt translates into, as the English name the model reads; null outside one.
  language: string | null;
  assets: readonly BotAsset[];
  // The names the display's asset tags found no picture for, added as they are met; null outside a display.
  unfound: Set<string> | null;
  // What a request's text left wrong, added as it is met; null outside a request (pipeline lay).
  problems: CbsProblem[] | null;
  // The namespaces of the modules on in the chat (design §6.5).
  modules: readonly string[];
  // {{source}} faces as data: URLs, null when absent.
  faces: { char: string | null; user: string | null };
  // pick and rollp keep Risu's seed: the character, the chat and its message count.
  pickSeed: string;
};

// Nested parses (inserted texts and calls) past this give Risu's error text, which {{iserror}} recognizes.
const DEPTH = 20;
const TOO_DEEP = 'ERROR: Call stack limit reached';

// Count every nesting level to bound self-expanding scripts on the evaluation thread.
const MOST_TAGS = 200_000;
const MOST_CHARS = 10_000_000;

// The evaluation went past what it may do and gave no text: not a part of one, which would read as whole.
export class Runaway extends Error {
  constructor() {
    super('CBS made too much text and was stopped');
  }
}

// Start-ordered steps, one per tag/block execution (including repeated #each/call); inserted texts have no steps.
// Offsets refer to the original text, headEnd ends a block's header, depth counts nesting; result stays escaped.
export type CbsStep = {
  at: number;
  end: number;
  headEnd?: number;
  depth: number;
  result: string;
  truncated?: true;
  // Why it stayed as written: no tag or block of that name, one Hazelle does not run, or arguments it cannot read.
  kept?: 'unknown' | 'unsupported' | 'args';
  // {{bkspc}} and {{erase}}, which change the text before them and give none.
  erased?: true;
  // #when, #if, #ifpure and {#if: whether the condition held, and #when's condition as it evaluated, argument by argument.
  held?: boolean;
  condition?: string[];
  // {{getvar}}: the name it read, as evaluated, so 시험해 보기 can say where the chat's value came from.
  variable?: string;
};
export type CbsTrace = { steps: CbsStep[]; omitted: number };

// The steps a trace keeps, and how much of each result: they cross to the page.
const MOST_STEPS = 500;
const MOST_RESULT = 1000;

// Temp variables and functions live as long as it, and spent counts against its limits.
type Run = { context: CbsContext; seed: string; temp: Map<string, string>; functions: Map<string, { body: Node[]; traced: boolean }>; spent: { tags: number; chars: number }; trace: CbsTrace | null };
// prefix sets the tags of an inserted text, a call or an #each item apart from those of the text around it,
// so each rolls its own. traced: its nodes stand in the text the trace places them in; level: their step depth.
type Frame = { run: Run; prefix: string; writes: boolean; depth: number; args: string[] | null; slots: Map<string, string>; traced: boolean; level: number };

// Callers must unescapeCbs once, at the very end. Runaway aborts the whole evaluation, never returning partial output.
export function evaluate(text: string, context: CbsContext, trace: CbsTrace | null = null): string {
  const { source } = context;
  const message = 'message' in source;
  const seed = message ? context.messages[source.message]!.seed : source.seed;
  const run: Run = { context, seed, temp: new Map(), functions: new Map(), spent: { tags: 0, chars: 0 }, trace };
  const out = enter(parse(prestep(text)), { run, prefix: '', writes: message, depth: 0, args: null, slots: new Map(), traced: trace !== null, level: 0 });
  if (trace) {
    const written = unstep(text);
    for (const step of trace.steps) Object.assign(step, { at: written(step.at), end: written(step.end) }, step.headEnd !== undefined && { headEnd: written(step.headEnd) });
  }
  return out;
}

// Risu reads <user>, <char> and <bot>, in any case, as those tags.
const STEPPED = /<(user|char|bot)>/gi;
const prestep = (text: string) => text.replace(STEPPED, (_, name: string) => `{{${name.toLowerCase()}}}`);
// A place in prestep's text back in the text as written: each rewrite before it is two characters longer there.
function unstep(text: string): (at: number) => number {
  const ends = [...text.matchAll(STEPPED)].map((match, index) => match.index + match[0].length + 2 * (index + 1));
  return (at) => at - 2 * ends.filter((end) => end <= at).length;
}

function stepFor(node: Tag | Block | Legacy, frame: Frame): CbsStep | null {
  const { trace } = frame.run;
  if (!trace || !frame.traced) return null;
  if (trace.steps.length >= MOST_STEPS) {
    trace.omitted += 1;
    return null;
  }
  const step: CbsStep = node.kind === 'block' ? { at: node.at, end: node.close.end, headEnd: node.head.end, depth: frame.level, result: '' } : { at: node.at, end: node.end, depth: frame.level, result: '' };
  trace.steps.push(step);
  return step;
}
const inside = (frame: Frame): Frame => (frame.traced ? { ...frame, level: frame.level + 1 } : frame);

function enter(nodes: Node[], frame: Frame): string {
  if (frame.depth > DEPTH) return TOO_DEEP;
  try {
    return evaluateNodes(nodes, frame);
  } catch (error) {
    if (error instanceof Return) return error.value;
    throw error;
  }
}

function evaluateNodes(nodes: Node[], frame: Frame): string {
  const { spent } = frame.run;
  let out = '';
  for (const node of nodes) {
    const step = typeof node === 'string' ? null : stepFor(node, frame);
    let piece: string | Erase;
    try {
      piece = typeof node === 'string' ? node : node.kind === 'tag' ? evaluateTag(node, frame, step) : node.kind === 'block' ? evaluateBlock(node, frame, step) : legacy(node, frame, step);
    } catch (error) {
      // {{return}} ends the text with its value, which each step it leaves through gave.
      if (step && error instanceof Return) {
        step.result = error.value.slice(0, MOST_RESULT);
        if (error.value.length > MOST_RESULT) step.truncated = true;
      }
      throw error;
    }
    if (step && typeof piece === 'string') {
      step.result = piece.slice(0, MOST_RESULT);
      if (piece.length > MOST_RESULT) step.truncated = true;
    }
    else if (step) step.erased = true;
    if (typeof node !== 'string') spent.tags++;
    if (typeof piece === 'string') spent.chars += piece.length;
    if (spent.tags > MOST_TAGS || spent.chars > MOST_CHARS) throw new Runaway();
    out = typeof piece === 'string' ? out + piece : piece(out);
  }
  return out;
}

const asWritten = (content: string) => `{{${content}}}`;

// Read only after the lookup fails: (, ), <, >, : and ; name handlers too.
export const isProse = (name: string) => !/[a-z]/i.test(name);

// At `::`, or at `:` when the first colon is single, so {{getvar:x}} works.
export function separatorOf(content: string): string | null {
  const colon = content.indexOf(':');
  return colon === -1 ? null : content[colon + 1] === ':' ? '::' : ':';
}

function splitArgs(content: string): string[] {
  const sep = separatorOf(content);
  return sep === null ? [content] : content.split(sep);
}

export function blockHead(content: string): { name: string; rest: string } | null {
  const match = /^\s*#([^\s:]*)([\s\S]*)$/.exec(content);
  return match && { name: normalize(match[1]!), rest: match[2]! };
}

const GETVAR = handlerFor('getvar');

// Evaluate inner tags before splitting the outer name/arguments so {{spread}} can supply arguments.
function evaluateTag(tag: Tag, frame: Frame, step: CbsStep | null): string | Erase {
  const content = evaluateNodes(tag.parts, inside(frame));
  if (content.startsWith('//')) return frame.run.context.stage === 'display' ? asWritten(content) : '';
  const [name, ...args] = content.startsWith('? ') ? ['calc', content.slice(2)] : content.trim() === ':' ? [':'] : splitArgs(content);
  const handler = handlerFor(name!);
  const { problems } = frame.run.context;
  const kept = (why: CbsStep['kept']) => {
    if (step) step.kept = why;
    return asWritten(content);
  };
  if (!handler) {
    if (isProse(name!)) return asWritten(content);
    problems?.push({ kind: 'unknown-tag', text: asWritten(content) });
    return kept(isUnsupportedTag(name!) ? 'unsupported' : 'unknown');
  }
  // Not a problem: a wrapper's {{slot}} takes no argument so that it stays as written (pipeline verbatim).
  if (args.length < handler.min) return kept('args');
  try {
    const out = handler.run(args, env(frame, frame.prefix + tag.at));
    if (step && handler === GETVAR) step.variable = args[0]!;
    if (typeof out === 'string' && isErrorText(out)) problems?.push({ kind: 'error-text', text: out });
    return out ?? kept('args');
  } catch (error) {
    // An argument out of range: a timestamp, a digit count, a code point, a repeat count.
    if (error instanceof RangeError) return kept('args');
    throw error;
  }
}

function env(frame: Frame, place: string): Env {
  const { run } = frame;
  let rolls: (() => number) | null = null;
  // traced: a function's body has places in the text it was defined in; an inserted text has none.
  const nested = (args: string[] | null, writes: boolean, traced: boolean): Frame => ({ run, prefix: `${place}>`, writes, depth: frame.depth + 1, args, slots: new Map(), traced, level: frame.level + 1 });
  return {
    context: run.context,
    writes: frame.writes,
    temp: run.temp,
    random: () => (rolls ??= seeded(`${run.seed}:${place}`))(),
    // An inserted text is not a chat message, so it writes no variables.
    insert: (text) => enter(parse(prestep(text)), nested(null, false, false)),
    call: (name, args) => {
      const defined = run.functions.get(name);
      return defined ? enter(defined.body, nested([name, ...args], frame.writes, defined.traced)) : null;
    },
    arg: (index) => frame.args?.[index] ?? null,
    slot: (name) => frame.slots.get(name) ?? null,
  };
}

// The blocks whose body is taken as its source and never evaluated, so a tag written in one is text.
const RAW = new Map<string, (raw: string, rest: string) => string>([
  ['escape', (raw, rest) => escapeCbs(rest === '::keep' ? raw : trimBlank(raw), '{}()')],
  ['pure', (raw) => raw],
  // Risu backslash-escapes the braces for its markdown; escaped braces survive the later passes and show as braces.
  ['puredisplay', (raw) => escapeCbs(raw, '{}')],
]);
export const isRawBlock = (name: string) => RAW.has(name);

// null: the block stays as written, as one no handler takes does, without counting as unknown.
const BLOCKS = new Map<string, (block: Block, rest: string, frame: Frame, step: CbsStep | null) => string | null>([
  ['when', when],
  ['if', (block, rest, frame, step) => (held(step, truthy(rest.trim())) ? evaluateNodes(trimLines(block.body), frame) : '')],
  ['ifpure', (block, rest, frame, step) => (held(step, truthy(rest.trim())) ? evaluateNodes(block.body, frame) : '')],
  ['each', each],
  ['code', (block, _rest, frame) => unbackslash(evaluateNodes(block.body, frame).replace(/[\n\r\t]/g, ''))],
  [
    'func',
    (block, rest, frame) => {
      // Names after the function's are not read: a body reads its arguments as {{arg::1}} on.
      const name = rest.trim().split(/\s+/)[0];
      if (!name) return null;
      frame.run.functions.set(name, { body: blankEnds(block.body), traced: frame.traced });
      return '';
    },
  ],
]);
export const isBlockName = (name: string) => RAW.has(name) || BLOCKS.has(name);
export const blockNames = () => [...RAW.keys(), ...BLOCKS.keys()];

function evaluateBlock(block: Block, outer: Frame, step: CbsStep | null): string {
  const frame = inside(outer);
  const head = evaluateNodes(block.head.parts, frame);
  const { name, rest } = blockHead(head)!;
  const raw = RAW.get(name);
  if (raw) return raw(block.raw, rest);
  const run = BLOCKS.get(name);
  if (!run && !isProse(name)) {
    frame.run.context.problems?.push({ kind: 'unknown-tag', text: asWritten(head) });
    if (step) step.kept = 'unknown';
  }
  const out = run?.(block, rest, frame, step);
  if (out == null && run && step) step.kept = 'args';
  return out ?? asWritten(head) + evaluateNodes(block.body, frame) + asWritten(evaluateNodes(block.close.parts, frame));
}

const held = (step: CbsStep | null, holds: boolean) => {
  if (step) step.held = holds;
  return holds;
};

// Only the branch taken is evaluated. Risu evaluates both and keeps one, so a setvar in the other ran too.
function when(block: Block, rest: string, frame: Frame, step: CbsStep | null): string {
  const { modes, condition } = whenArgs(rest);
  if (step) step.condition = condition.map((arg) => arg.slice(0, MOST_RESULT));
  const holds = held(step, condition.length > 0 && fold(condition, frame.run.context));
  if (modes.includes('legacy')) return holds ? evaluateNodes(trimLines(block.body), frame) : '';
  const split = block.body.findIndex(isElse);
  const branch = holds ? (split === -1 ? block.body : block.body.slice(0, split)) : split === -1 ? [] : block.body.slice(split + 1);
  return evaluateNodes(modes.includes('keep') ? branch : blankEnds(branch), frame);
}

// Legacy if uses Risu's '', '0', '-1' falsiness, not #if truthiness; evaluate only the taken body.
function legacy(node: Legacy, outer: Frame, step: CbsStep | null): string {
  const frame = inside(outer);
  const split = node.parts.findIndex((part) => typeof part === 'string' && part.includes('\n'));
  const asLegacy = () => `{#${evaluateNodes(node.parts, frame)}#}`;
  if (split === -1) return asLegacy();
  const line = node.parts[split] as string;
  const newline = line.indexOf('\n');
  const statement = evaluateNodes([...node.parts.slice(0, split), line.slice(0, newline)], frame).split(' ', 2);
  if (statement[0] !== 'if') return asLegacy();
  if (!held(step, !['', '0', '-1'].includes(statement[1]!))) return '';
  const body = [line.slice(newline + 1), ...node.parts.slice(split + 1)];
  return evaluateNodes(
    trimEnds(
      body,
      (text) => text.trimStart(),
      (text) => text.trimEnd(),
    ),
    frame,
  );
}

// Anywhere on the block's own level; Risu wants it alone on a line in a body of several lines.
const isElse = (node: Node) => typeof node === 'object' && node.kind === 'tag' && node.parts.length === 1 && typeof node.parts[0] === 'string' && node.parts[0].trim() === ':else';

const UNARY = new Map<string, (value: string, context: CbsContext) => boolean>([
  ['not', (value) => !truthy(value)],
  ['var', (name, context) => truthy(readVar(context, name))],
  ['toggle', (key, context) => truthy(readToggle(context, key))],
]);
const BINARY = new Map<string, (left: string, right: string, context: CbsContext) => boolean>([
  ['and', (a, b) => truthy(a) && truthy(b)],
  ['or', (a, b) => truthy(a) || truthy(b)],
  ['is', (a, b) => a === b],
  ['isnot', (a, b) => a !== b],
  ['>', (a, b) => Number(a) > Number(b)],
  ['<', (a, b) => Number(a) < Number(b)],
  ['>=', (a, b) => Number(a) >= Number(b)],
  ['<=', (a, b) => Number(a) <= Number(b)],
  ['vis', (name, value, context) => readVar(context, name) === value],
  ['visnot', (name, value, context) => readVar(context, name) !== value],
  ['tis', (key, value, context) => readToggle(context, key) === value],
  ['tisnot', (key, value, context) => readToggle(context, key) !== value],
]);

export function whenArgs(rest: string): { modes: string[]; condition: string[] } {
  const trimmed = rest.trim();
  const args = rest.startsWith(':') ? splitArgs(rest).slice(1) : trimmed ? [trimmed] : [];
  let first = 0;
  while (args[first] === 'keep' || args[first] === 'legacy') first += 1;
  return { modes: args.slice(0, first), condition: args.slice(first) };
}

// Apply operators right-to-left over everything to their right: not::a::and::b means not (a and b).
// Steps retain left-operand indices; the first consumes the final argument. A misplaced value makes it false.
export function conditionSteps(condition: string[]): { steps: { op: string; left?: number }[]; valid: boolean } {
  const steps: { op: string; left?: number }[] = [];
  for (let i = condition.length - 2; i >= 0; i--) {
    const op = condition[i]!;
    if (UNARY.has(op)) steps.push({ op });
    else if (BINARY.has(op) && i > 0) steps.push({ op, left: --i });
    else return { steps, valid: false };
  }
  return { steps, valid: true };
}

function fold(condition: string[], context: CbsContext): boolean {
  const { steps, valid } = conditionSteps(condition);
  if (!valid) return false;
  let value = condition.at(-1)!;
  for (const { op, left } of steps) value = bool(left === undefined ? UNARY.get(op)!(value, context) : BINARY.get(op)!(condition[left]!, value, context));
  return truthy(value);
}

// #each ARRAY as NAME, or ARRAY NAME; `::keep` right after #each keeps the body's layout. null: no name.
function each(block: Block, rest: string, frame: Frame): string | null {
  const keep = rest.startsWith('::keep');
  // Split before trimming: an unset array leaves ` as x`, which is no items.
  const spec = (keep ? rest.slice('::keep'.length) : rest).trimEnd();
  const as = spec.lastIndexOf(' as ');
  const at = as === -1 ? spec.lastIndexOf(' ') : as;
  if (at === -1) return null;
  const name = spec.slice(at + (as === -1 ? 1 : ' as '.length)).trim();
  const body = keep ? block.body : trimLines(block.body);
  const place = frame.prefix + block.at;
  return items(spec.slice(0, at).trim())
    .map((item, i) => evaluateNodes(body, { ...frame, prefix: `${place}.${i}>`, slots: new Map([...frame.slots, [name, item]]) }))
    .join('');
}

// Trim source layout only, never whitespace emitted by inner tags such as {{br}}; Risu trims output instead.
function trimEnds(nodes: Node[], start: (text: string) => string, end: (text: string) => string): Node[] {
  const out = [...nodes];
  const first = out[0];
  if (typeof first === 'string') out[0] = start(first);
  const last = out.at(-1);
  if (typeof last === 'string') out[out.length - 1] = end(last);
  return out;
}
const LEADING_BLANK = /^(?:[ \t]*\r?\n)+/;
const TRAILING_BLANK = /(?:\r?\n[ \t]*)+$/;
const trimBlank = (text: string) => text.replace(LEADING_BLANK, '').replace(TRAILING_BLANK, '');
const blankEnds = (nodes: Node[]) =>
  trimEnds(
    nodes,
    (text) => text.replace(LEADING_BLANK, ''),
    (text) => text.replace(TRAILING_BLANK, ''),
  );
// #if: each line's leading whitespace, then the whole body.
const trimLines = (nodes: Node[]) =>
  trimEnds(
    nodes.map((node) => (typeof node === 'string' ? node.replace(/\n[ \t]+/g, '\n') : node)),
    (text) => text.trimStart(),
    (text) => text.trimEnd(),
  );

const BACKSLASHED: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
const unbackslash = (text: string) =>
  text.replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|[\s\S])/g, (_, code: string) => (code.length > 1 ? String.fromCharCode(parseInt(code.slice(1), 16)) : (BACKSLASHED[code] ?? code)));
