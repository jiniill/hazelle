import { MODEL_MOST, TYPE } from './pulse';

// 자동 진단 (design §6.13): what a browser reports without a press, read by the operator unencrypted. REPORT is the
// allowlist and the server keeps nothing it refuses: no text but a closed list's word, and no name. Widening it widens
// what the privacy policy (app/common/legal) promises, so a new field goes there as well.

export const AUTO_KEEP_DAYS = 30;

export const AUTO_EVENTS = ['app-error', 'worker-trouble', 'turn-failed', 'memory-failed', 'memory-gap', 'memory-gap-ended', 'chat-unopened'] as const;
export type AutoEvent = (typeof AUTO_EVENTS)[number];

// An error's name, or the kind of a failure. Never an error's message, which can quote what it failed on.
export const AUTO_ERROR_NAMES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'DataCloneError', 'InvalidStateError', 'NetworkError', 'NotFoundError', 'QuotaExceededError', 'SecurityError', 'TimeoutError', 'other'] as const;
export type AutoErrorName = (typeof AUTO_ERROR_NAMES)[number];
const FAILURES = ['unsent', 'unsaved', 'too-long', 'runaway', 'tokenizer', 'unstarted', 'unpulled', 'gone', 'untranslated', 'preread', 'agent', 'no-model', 'model-gone', 'image-only', 'prompt-missing', 'profile-missing', 'failed', 'invalid', 'embed'] as const;
// Why messages leave a request and are in no memory sent: the first that holds names the warning (runtime/memory-view).
export const GAP_CAUSES = ['working', 'failed', 'tool', 'off', 'no-slot', 'stale', 'over', 'forgotten', 'no-room', 'unknown'] as const;
export type GapCause = (typeof GAP_CAUSES)[number];
const DETAILS = [...AUTO_ERROR_NAMES, ...FAILURES, ...GAP_CAUSES] as const;

const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'samsung', 'other'] as const;
const SYSTEMS = ['windows', 'mac', 'linux', 'android', 'ios', 'other'] as const;
const SOURCES = ['prior', 'model', 'chat', 'drift-reset', 'unavailable'] as const;
const BOUNDS = ['hard-upper', 'hard-centre', 'user-centre', 'refusal'] as const;

const orNull = <S extends Spec>(spec: S) => ({ orNull: spec });

const CHAT = {
  type: orNull(TYPE),
  // The id the model was asked by. The server keeps its name only when a list it holds confirms it (server/pulse).
  model: orNull(new RegExp(`^.{1,${MODEL_MOST}}$`, 's')),
  hardContext: orNull('number'),
  context: orNull('number'),
  reply: orNull('number'),
  messages: orNull('number'),
  character: 'flag',
  memory: { on: 'flag', own: 'flag', budget: 'number', clamped: orNull('number'), window: 'number', batch: 'number' },
  // Seconds since the page opened, which tells a device just switched to.
  page: 'number',
  // The summaries still to run on this page, and what stopped them.
  work: { left: orNull('number'), failed: orNull(FAILURES) },
  // On memory-gap-ended: how long the warning stayed, in seconds, and the most messages it named.
  gap: orNull({ lasted: 'number', most: 'number' }),
  request: orNull({
    messages: 'number',
    dropped: 'number',
    unseen: 'number',
    problems: 'number',
    covered: orNull('number'),
    missing: orNull('number'),
    slot: orNull('flag'),
    tool: orNull('flag'),
    records: orNull({ over: 'number', stale: 'number', forgotten: 'number', deleted: 'number', changed: 'number', rendered: 'number' }),
    source: SOURCES,
    bound: orNull(BOUNDS),
    multiplier: orNull('number'),
    allowance: orNull('number'),
    inputLimit: orNull('number'),
    evidence: 'number',
    cold: 'flag',
  }),
} as const;

const REPORT = {
  event: AUTO_EVENTS,
  detail: orNull(DETAILS),
  version: orNull(/^[\w.+-]{1,40}$/),
  browser: BROWSERS,
  major: orNull('number'),
  os: SYSTEMS,
  mobile: 'flag',
  // Where in the app's own bundle an error was thrown: a file and a position, no function's name.
  place: orNull(/^[\w.-]{1,100}\.js:\d{1,9}:\d{1,9}$/),
  chat: orNull(CHAT),
} as const;

type Spec = 'number' | 'flag' | RegExp | readonly string[] | { readonly orNull: Spec } | { readonly [key: string]: Spec };
type Read<S> = S extends 'number' ? number : S extends 'flag' ? boolean : S extends RegExp ? string : S extends readonly (infer Word)[] ? Word : S extends { readonly orNull: infer Inner } ? Read<Inner> | null : { -readonly [K in keyof S]: Read<S[K]> };

export type AutoReport = Read<typeof REPORT>;
export type AutoChat = Read<typeof CHAT>;
export type AutoDetail = NonNullable<AutoReport['detail']>;

const FIGURE_MOST = 1e12;

function fits(spec: Spec, value: unknown): boolean {
  if (spec === 'number') return typeof value === 'number' && Math.abs(value) <= FIGURE_MOST;
  if (spec === 'flag') return typeof value === 'boolean';
  if (spec instanceof RegExp) return typeof value === 'string' && spec.test(value);
  if (Array.isArray(spec)) return (spec as readonly unknown[]).includes(value);
  if ('orNull' in spec) return value === null || fits(spec.orNull as Spec, value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const shape = spec as { readonly [key: string]: Spec };
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === Object.keys(shape).length && Object.keys(shape).every((key) => Object.hasOwn(fields, key) && fits(shape[key]!, fields[key]));
}

// null for anything this release does not send: a field more or less, or a word off its list.
export const readAutoReport = (value: unknown): AutoReport | null => (fits(REPORT, value) ? (value as AutoReport) : null);

// The operator's view, a day's rows of one kind of problem. people: distinct hashes of that day.
export type AutoRow = { day: number; event: AutoEvent; detail: string; version: string; place: string; people: number; times: number; at: number; facts: string };
