import { MODEL_MOST, TYPE } from './pulse';

// 자동 진단 (design §6.13): what a browser reports without a press, read by the operator unencrypted. REPORT is the
// allowlist and the server keeps nothing it refuses: no text but a closed list's word, and no name. Widening it widens
// what the privacy policy (app/common/legal) promises, so a new field goes there as well.

export const AUTO_KEEP_DAYS = 30;

export const AUTO_EVENTS = ['app-error', 'worker-trouble', 'turn-failed', 'memory-failed', 'memory-gap', 'memory-gap-ended', 'chat-unopened', 'cache-broken'] as const;
export type AutoEvent = (typeof AUTO_EVENTS)[number];

// An error's name, or the kind of a failure. Never an error's message, which can quote what it failed on.
export const AUTO_ERROR_NAMES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'DataCloneError', 'InvalidStateError', 'NetworkError', 'NotFoundError', 'QuotaExceededError', 'SecurityError', 'TimeoutError', 'other'] as const;
export type AutoErrorName = (typeof AUTO_ERROR_NAMES)[number];
const FAILURES = ['unsent', 'unsaved', 'too-long', 'runaway', 'tokenizer', 'unstarted', 'unpulled', 'gone', 'untranslated', 'preread', 'agent', 'no-model', 'model-gone', 'image-only', 'prompt-missing', 'profile-missing', 'failed', 'invalid', 'embed'] as const;
// Why messages leave a request and are in no memory sent: the first that holds names the warning (runtime/memory-view).
export const GAP_CAUSES = ['working', 'failed', 'tool', 'off', 'no-slot', 'stale', 'over', 'forgotten', 'no-room', 'unknown'] as const;
export type GapCause = (typeof GAP_CAUSES)[number];
// The first cause a cache break proves, or the break's own kind without one.
const CACHE_CAUSES = ['tag', 'lore', 'moved', 'edited', 'memory', 'model', 'account', 'reasoning', 'far', 'changed', 'added', 'removed'] as const;
export type CacheCauseWord = (typeof CACHE_CAUSES)[number];
const DETAILS = [...AUTO_ERROR_NAMES, ...FAILURES, ...GAP_CAUSES, ...CACHE_CAUSES] as const;

const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'samsung', 'other'] as const;
const SYSTEMS = ['windows', 'mac', 'linux', 'android', 'ios', 'other'] as const;
const SOURCES = ['prior', 'model', 'chat', 'drift-reset', 'unavailable'] as const;
const BOUNDS = ['hard-upper', 'hard-centre', 'user-centre', 'refusal'] as const;

const orNull = <S extends Spec>(spec: S) => ({ orNull: spec });

// A word a closed list in the app gave, or a provider's or the server's code. Spaces and sentences cannot pass.
const WORD = /^[\w:.-]{1,60}$/;
export const closedWord = (word: string) => (WORD.test(word) ? word : 'other');

const CALL = {
  state: ['done', 'cut', 'failed'],
  cut: orNull(['length', 'no-terminal', 'stopped', 'refused']),
  finish: orNull(WORD),
  error: orNull(['refused', 'relay', 'app', 'provider', 'bad-event', 'network', 'offline', 'no-token', 'pool']),
  status: orNull('number'),
  code: orNull(WORD),
  tries: orNull('number'),
  input: orNull('number'),
  cached: orNull('number'),
  written: orNull('number'),
  output: orNull('number'),
  reasoning: orNull('number'),
  first: orNull('number'),
  total: 'number',
} as const;

const FAILURE = { kind: FAILURES, reason: orNull(WORD), call: orNull(CALL) } as const;

const SHAPE = {
  budget: 'number',
  used: 'number',
  fixed: 'number',
  free: 'number',
  state: 'number',
  stateLimit: 'number',
  threads: 'number',
  chapters: 'numbers',
  sources: 'numbers',
  records: { tokens: 'number', largest: 'number' },
  status: 'counts',
  pinned: 'number',
  edited: 'number',
  recalled: 'number',
} as const;

const CACHE = { broken: orNull(WORD), read: orNull('number'), of: orNull('number'), written: 'number', tail: 'number', prefix: 'flag', changes: 'counts', causes: 'counts', missing: orNull('number') } as const;

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
  // The model that writes this chat's summaries; the server treats its id as it does model's.
  aux: { type: orNull(TYPE), model: orNull(new RegExp(`^.{1,${MODEL_MOST}}$`, 's')) },
  // How much the chat's memory holds, null while the chat is not loaded.
  stored: orNull({ records: 'number', chapters: 'number', facts: 'number', threads: 'number' }),
  // The summaries still to run on this page, and what stopped them: records in failed, chapters in chapter.
  work: { left: orNull('number'), failed: orNull(FAILURE), chapter: orNull(FAILURE) },
  // The latest message's call, on any report.
  last: orNull(CALL),
  // On turn-failed: what the failure says besides its kind.
  turn: orNull({ reason: orNull(WORD), tokens: orNull('number'), budget: orNull('number') }),
  // On cache-broken.
  cache: orNull(CACHE),
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
    tokens: 'counts',
    lore: { fired: 'number', silent: 'number', invalidKeys: 'number', budget: orNull('number') },
    shape: orNull(SHAPE),
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
  // The stack's positions in the bundle, outermost last: place is the first of them, where it was thrown.
  frames: orNull(/^[\w.-]{1,100}\.js:\d{1,9}:\d{1,9}(?: [\w.-]{1,100}\.js:\d{1,9}:\d{1,9}){0,11}$/),
  origin: orNull(['error', 'rejection']),
  // The kind of screen last open (shell/routes), never what is on it.
  screen: orNull(/^[a-z-]{1,30}$/),
  // Seconds since the page opened, which tells a device just switched to.
  page: 'number',
  online: 'flag',
  visible: 'flag',
  standalone: 'flag',
  cores: orNull('number'),
  memoryGb: orNull('number'),
  width: 'number',
  height: 'number',
  language: orNull(/^[A-Za-z-]{2,20}$/),
  chat: orNull(CHAT),
} as const;

type Spec = 'number' | 'numbers' | 'counts' | 'flag' | RegExp | readonly string[] | { readonly orNull: Spec } | { readonly [key: string]: Spec };
type Read<S> = S extends 'number' ? number : S extends 'numbers' ? number[] : S extends 'counts' ? Record<string, number> : S extends 'flag' ? boolean : S extends RegExp ? string : S extends readonly (infer Word)[] ? Word : S extends { readonly orNull: infer Inner } ? Read<Inner> | null : { -readonly [K in keyof S]: Read<S[K]> };

export type AutoReport = Read<typeof REPORT>;
export type AutoChat = Read<typeof CHAT>;
export type AutoCall = Read<typeof CALL>;
export type AutoFailure = Read<typeof FAILURE>;
export type AutoCache = Read<typeof CACHE>;
export type AutoDetail = NonNullable<AutoReport['detail']>;

const FIGURE_MOST = 1e12;
const LIST_MOST = 500;
const figure = (value: unknown) => typeof value === 'number' && Math.abs(value) <= FIGURE_MOST;

function fits(spec: Spec, value: unknown): boolean {
  if (spec === 'number') return figure(value);
  if (spec === 'numbers') return Array.isArray(value) && value.length <= LIST_MOST && value.every(figure);
  if (spec === 'counts') return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length <= LIST_MOST && Object.entries(value).every(([key, count]) => WORD.test(key) && figure(count));
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
