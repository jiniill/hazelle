import { MODEL_MOST, TYPE } from './pulse';

// 자동 진단 (design §6.13): what a browser reports without a press, read by the operator unencrypted. REPORT is the
// allowlist and the server keeps nothing it refuses: no text but a closed list's word, and no name. Widening it widens
// what the privacy policy (app/common/legal) promises, so a new field goes there as well.

export const AUTO_KEEP_DAYS = 30;

const AUTO_EVENTS = ['app-error', 'page-slow', 'worker-trouble', 'evaluation-stuck', 'evaluation-slow', 'script-stuck', 'turn-failed', 'memory-failed', 'memory-gap', 'memory-gap-ended', 'chat-unopened', 'cache-broken'] as const;
export type AutoEvent = (typeof AUTO_EVENTS)[number];

// An error's name, or the kind of a failure. Never an error's message, which can quote what it failed on.
export const AUTO_ERROR_NAMES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'DataCloneError', 'InvalidStateError', 'NetworkError', 'NotFoundError', 'QuotaExceededError', 'SecurityError', 'TimeoutError', 'other'] as const;
export type AutoErrorName = (typeof AUTO_ERROR_NAMES)[number];
const AUTO_ERROR_CAUSES = ['fetch', 'module-import', 'other'] as const;
export type AutoErrorCause = (typeof AUTO_ERROR_CAUSES)[number];
// Exact fixed browser text only. Prefixes, URLs, translated messages and arbitrary text must remain 'other'.
export const AUTO_BROWSER_MESSAGES = [
  { message: 'Load failed', cause: 'fetch' },
  { message: 'Failed to fetch', cause: 'fetch' },
  { message: 'NetworkError when attempting to fetch resource.', cause: 'fetch' },
  { message: 'Importing a module script failed.', cause: 'module-import' },
  { message: 'Importing a module script is canceled.', cause: 'module-import' },
] as const satisfies readonly { message: string; cause: AutoErrorCause }[];
// Why a held chat did not open (runtime/store/store): its own failures and the server's two; any other code is 'other'.
export const AUTO_OPEN_FAILURES = ['offline', 'server-error', 'unreadable', 'bot-stuck', 'evaluation-unavailable', 'codec-unavailable'] as const;
const FAILURES = ['unsent', 'unsaved', 'too-long', 'runaway', 'tokenizer', 'unstarted', 'unpulled', 'gone', 'untranslated', 'additional', 'preread', 'agent', 'no-model', 'model-gone', 'image-only', 'prompt-missing', 'profile-missing', 'failed', 'invalid', 'embed'] as const;
// Why messages leave a request and are in no memory sent: the first that holds names the warning (runtime/tasks/memory-view).
const GAP_CAUSES = ['working', 'failed', 'tool', 'off', 'no-slot', 'stale', 'over', 'forgotten', 'unrecorded', 'no-room', 'unknown'] as const;
export type GapCause = (typeof GAP_CAUSES)[number];
// The first cause a cache break proves, or the break's own kind without one.
const CACHE_CAUSES = ['tag', 'lore', 'moved', 'edited', 'memory', 'model', 'account', 'reasoning', 'far', 'changed', 'added', 'removed'] as const;
export type CacheCauseWord = (typeof CACHE_CAUSES)[number];
// Who asks the evaluation worker for a job, and the kinds of job it runs: runtime/evaluation/evaluation holds its lanes and its
// jobs to these, so a word neither list has cannot be reported.
const EVALUATION_ASKERS = ['projection', 'screen', 'headless', 'forecast', 'cache-diagnosis', 'memory', 'view', 'auto-translation', 'auto-illustration', 'mascot', 'status', 'rewrite', 'polish', 'agent', 'send', 'translation', 'illustration', 'lore', 'tool', 'export', 'trial', 'onboarding'] as const;
export type EvaluationAsker = (typeof EVALUATION_ASKERS)[number];
// How a page went slow (runtime/diagnostics/frames): one frame that held it, or many that added up.
const SLOW_PAGES = ['frozen', 'janky'] as const;
export type SlowPage = (typeof SLOW_PAGES)[number];
// What stopped answering outside the evaluation worker: the Lua worker (silent, or gone by an error of its own) and a
// plugin's frame (runtime/scripts/interactions).
const STUCK_SCRIPTS = ['lua', 'lua-crashed', 'tool', 'tool-disabled'] as const;
export type StuckScript = (typeof STUCK_SCRIPTS)[number];
const EVALUATION_JOBS = ['cache-diagnosis', 'display', 'prompt', 'rewrite', 'translation', 'memory', 'illustration', 'mascot', 'preread', 'agent', 'status', 'read', 'lore', 'state', 'variables', 'text', 'onboarding', 'patch', 'count', 'sample'] as const;
const DETAILS = [...AUTO_ERROR_NAMES, ...AUTO_OPEN_FAILURES, ...FAILURES, ...GAP_CAUSES, ...CACHE_CAUSES, ...EVALUATION_JOBS, ...SLOW_PAGES, ...STUCK_SCRIPTS] as const;

const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'samsung', 'other'] as const;
const SYSTEMS = ['windows', 'mac', 'linux', 'android', 'ios', 'other'] as const;
const SOURCES = ['prior', 'model', 'chat', 'drift-reset', 'unavailable'] as const;
const BOUNDS = ['hard-upper', 'hard-centre', 'user-centre', 'refusal'] as const;
// 요청 경로 (runtime/models/relay CallRoute).
const CALLS = ['server', 'browser', 'proxy'] as const;

const orNull = <S extends Spec>(spec: S) => ({ orNull: spec });
const listOf = <S extends Spec>(spec: S) => ({ listOf: spec });

// A word a closed list in the app gave, or a provider's or the server's code. Spaces and sentences cannot pass.
const WORD = /^[\w:.-]{1,60}$/;
export const closedWord = (word: string) => (WORD.test(word) ? word : 'other');

const CALL = {
  state: ['done', 'cut', 'failed'],
  cut: orNull(['length', 'no-terminal', 'stopped', 'refused', 'repeated']),
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

// refused: the evaluation turned the job away under its chat's verdict. A bot-stuck reason without it is a job of the
// chat that went silent on this page, which that job's evaluation-stuck report names.
// wrong: in a memory answer refused for a field, where the first thing of the wrong kind stood and its kind.
const WRONG = { part: ['itself', 'item', 'about', 'field', 'value', 'speaker', 'text'], was: ['missing', 'null', 'text', 'blank', 'number', 'boolean', 'object', 'list'] } as const;
const FAILURE = { kind: FAILURES, reason: orNull(WORD), wrong: orNull(WRONG), refused: 'flag', call: orNull(CALL) } as const;

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
  // Where the account's provider calls leave from.
  calls: CALLS,
  // The id the model was asked by. The server keeps its name only when a list it holds confirms it (server/pulse).
  model: orNull(new RegExp(`^.{1,${MODEL_MOST}}$`, 's')),
  hardContext: orNull('number'),
  context: orNull('number'),
  reply: orNull('number'),
  messages: orNull('number'),
  character: 'flag',
  // How much its bot holds, over every pack on it: regex scripts, triggers and those of them that are Lua, lore entries,
  // assets, modules, and whether any pack draws a background.
  bot: { regex: 'number', triggers: 'number', lua: 'number', lore: 'number', assets: 'number', modules: 'number', background: 'flag' },
  // What its display last made, null while it has none: the messages' texts past it, their characters, the longest of
  // them, the CSS, the boxes taken out, and whether its bot was judged stuck.
  shown: orNull({ texts: 'number', chars: 'number', longest: 'number', css: 'number', boxes: 'number', stuck: 'flag' }),
  memory: { on: 'flag', own: 'flag', budget: 'number', clamped: orNull('number'), window: 'number', batch: 'number' },
  // The model that writes this chat's summaries; the server treats its id as it does model's.
  aux: { type: orNull(TYPE), model: orNull(new RegExp(`^.{1,${MODEL_MOST}}$`, 's')) },
  // How much the chat's memory holds, null while the chat is not loaded.
  stored: orNull({ records: 'number', chapters: 'number', facts: 'number', threads: 'number' }),
  // The summaries still to run on this page, and what stopped them: records in failed, chapters in chapter, the
  // records' embeddings in index.
  work: { left: orNull('number'), failed: orNull(FAILURE), chapter: orNull(FAILURE), index: orNull(FAILURE) },
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

// What a worker says it is about to begin (engine/progress): the kind of unit, the stage a regex script runs at, the
// message's place, the script's place among the packs' and the characters it reads. Never a pattern or a text.
// regex: a script's search of a text. write: what a script that found something writes. cbs: a text's CBS read at a
// stage. finish: a shown text's own markup placed. styles: the display's styles gathered.
export const UNIT_KINDS = ['message', 'show', 'cbs', 'regex', 'write', 'repeat', 'finish', 'styles', 'lore', 'cache', 'inflate', 'count'] as const;
export const UNIT_STAGES = ['input', 'output', 'process', 'display', 'translation'] as const;
const UNIT = { kind: UNIT_KINDS, stage: orNull(UNIT_STAGES), message: orNull('number'), script: orNull('number'), chars: orNull('number') } as const;

// On evaluation-stuck and evaluation-slow, whose detail is the job's kind: the job that went silent or ran long, in
// closed words and sizes.
const JOB = {
  // null: a job no chat's lane asked for.
  asker: orNull(EVALUATION_ASKERS),
  // false: a verdict had already taken the bot's regex out of it.
  regex: 'flag',
  // What the job read, null for one that reads no chat: regex scripts as it ran, messages and their characters, lore entries.
  // longest: its longest message. packs, assets, variables: how many it holds.
  scope: orNull({ regex: 'number', messages: 'number', chars: 'number', longest: 'number', lore: 'number', packs: 'number', assets: 'number', variables: 'number' }),
  // The jobs waiting behind it.
  waiting: 'number',
  // The jobs its worker had answered before it, 0 on a worker just opened.
  jobs: 'number',
  // Milliseconds from its start to the silence that ended it.
  ran: 'number',
  // The signs of life it posted before that (runtime/worker SIGN_MS apart at least).
  signs: 'number',
  // The units that ended, the last one it named, and how long ago in milliseconds: the silent unit is that one or one
  // begun in the SIGN_MS after it. Null for a job that named none.
  units: 'number',
  unit: orNull(UNIT),
  quiet: 'number',
  // Its slowest units that ended, slowest first, each with how long it took.
  slow: listOf({ ...UNIT, ms: 'number' }),
  // Where its time went: the units that ended and the milliseconds they took, added up by kind and stage.
  spent: listOf({ kind: UNIT_KINDS, stage: orNull(UNIT_STAGES), units: 'number', ms: 'number' }),
} as const;

// On script-stuck from the Lua worker: the job last posted to it, what waited on it and for how long. Null from a
// plugin's frame.
export const SCRIPT_EVENTS = ['input', 'start', 'output', 'button', 'form', 'call', 'edit', 'reply', 'replying', 'sending', 'requesting', 'calling', 'showing', 'prompt'] as const;
const SCRIPT = {
  job: ['run', 'install-display', 'display', 'check'],
  event: orNull(SCRIPT_EVENTS),
  preview: 'flag',
  triggers: 'number',
  messages: 'number',
  chars: 'number',
  pending: 'number',
  waited: 'number',
} as const;

export const FRAME_INVOKERS = ['user-callback', 'event-listener', 'resolve-promise', 'reject-promise', 'classic-script', 'module-script'] as const;
// A frame that held the page (the browser's long animation frame), in milliseconds: its length, what of it blocked
// input, its scripts' time and the layout they forced, the rendering after them, how many scripts ran, and the longest
// of them: whether it is the app's own, where in the bundle it starts and what called it. recent: the blocking of the
// last WINDOW_MS, this frame's with it.
const FRAME = {
  ms: 'number',
  blocked: 'number',
  script: 'number',
  forced: 'number',
  render: 'number',
  scripts: 'number',
  own: orNull('flag'),
  place: orNull(/^[\w.-]{1,100}\.js:\d{1,9}$/),
  invoker: orNull(FRAME_INVOKERS),
  recent: 'number',
} as const;

const REPORT = {
  event: AUTO_EVENTS,
  detail: orNull(DETAILS),
  cause: orNull(AUTO_ERROR_CAUSES),
  version: orNull(/^[\w.+-]{1,40}$/),
  browser: BROWSERS,
  major: orNull('number'),
  os: SYSTEMS,
  mobile: 'flag',
  // Where in the app's own bundle an error was thrown: a file and a position, no function's name.
  place: orNull(/^[\w.-]{1,100}\.js:\d{1,9}:\d{1,9}$/),
  // The stack's positions in the bundle, outermost last: place is the first of them, where it was thrown.
  frames: orNull(/^[\w.-]{1,100}\.js:\d{1,9}:\d{1,9}(?: [\w.-]{1,100}\.js:\d{1,9}:\d{1,9}){0,11}$/),
  // screen: a screen's error boundary caught it, and the screen went down (app/common/ScreenLoad).
  origin: orNull(['error', 'rejection', 'screen']),
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
  dpr: 'number',
  touch: 'flag',
  reducedMotion: 'flag',
  // The page's script memory and its limit in MB, where the browser tells.
  heapMb: orNull('number'),
  heapLimitMb: orNull('number'),
  net: orNull(['slow-2g', '2g', '3g', '4g']),
  saveData: orNull('flag'),
  // The browser had thrown the tab away and loaded it again.
  discarded: 'flag',
  entered: orNull(['navigate', 'reload', 'back_forward', 'prerender']),
  // The page's elements outside the stories' own roots.
  dom: 'number',
  shadow: 'number',
  // The errors thrown on this page so far.
  errors: 'number',
  // The frames over 50 ms since the page opened, their blocking added up and the longest, null where the browser
  // reports none.
  stalls: orNull({ count: 'number', blocked: 'number', worst: 'number' }),
  // What the page did last, oldest first, each a closed word, how long ago in milliseconds, and a number of its own
  // (a duration, a count) or null (noteStep).
  trail: listOf({ word: WORD, ago: 'number', n: orNull('number') }),
  // The chat the problem is about, or the one on screen when it is about none.
  chat: orNull(CHAT),
  job: orNull(JOB),
  script: orNull(SCRIPT),
  frame: orNull(FRAME),
} as const;

type Spec = 'number' | 'numbers' | 'counts' | 'flag' | RegExp | readonly string[] | { readonly orNull: Spec } | { readonly listOf: Spec } | { readonly [key: string]: Spec };
type Read<S> = S extends 'number' ? number : S extends 'numbers' ? number[] : S extends 'counts' ? Record<string, number> : S extends 'flag' ? boolean : S extends RegExp ? string : S extends readonly (infer Word)[] ? Word : S extends { readonly orNull: infer Inner } ? Read<Inner> | null : S extends { readonly listOf: infer Each } ? Read<Each>[] : { -readonly [K in keyof S]: Read<S[K]> };

export type AutoReport = Read<typeof REPORT>;
export type AutoChat = Read<typeof CHAT>;
export type AutoJob = Read<typeof JOB>;
export type AutoUnit = Read<typeof UNIT>;
export type AutoScript = Read<typeof SCRIPT>;
export type AutoFrame = Read<typeof FRAME>;
export type AutoStep = AutoReport['trail'][number];
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
  if ('listOf' in spec) return Array.isArray(value) && value.length <= LIST_MOST && value.every((each) => fits(spec.listOf as Spec, each));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const shape = spec as { readonly [key: string]: Spec };
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === Object.keys(shape).length && Object.keys(shape).every((key) => Object.hasOwn(fields, key) && fits(shape[key]!, fields[key]));
}

// null for anything this release does not send: a field more or less, or a word off its list.
export const readAutoReport = (value: unknown): AutoReport | null => (fits(REPORT, value) ? (value as AutoReport) : null);

// The operator's view, a day's rows of one kind of problem. people: distinct hashes of that day.
export type AutoRow = { day: number; event: AutoEvent; detail: string; version: string; place: string; people: number; times: number; at: number; facts: string };
