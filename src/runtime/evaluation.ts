import type { CacheComparison, CacheDiagnosis } from '../model/cache';
import { Runaway } from '../engine/cbs/evaluate';
import type { DisplayPatch } from '../engine/display';
import type { RegexScript } from '../engine/import/types';
import type { AgentInput, assembleAgent, assembleIllustration, assembleMascot, assembleMemory, assemblePreread, assembleTranslation, IllustrationInput, MascotInput, MemoryTaskInput, PrereadInput, PromptInput, RanAway, TranslationInput } from '../engine/pipeline';
import type { ChatScope, VariableInspection } from '../engine/render';
import type { ApiFailure } from './api';
import type { ChatTexts, Counted, DisplayEvaluation, EvaluatedPrompt, EvaluationDown, EvaluationInput, EvaluationJob, EvaluationResult, EvaluationUp, LuaResult, ToolState, TrialRead } from './evaluation-core';
import { autoDiagnose } from './auto-diagnosis';
import { noteProblem } from './diagnostics';
import { changedTail, sameHistory } from './history-delta';
import { Heartbeat, moduleWorker } from './worker';
import workerUrl from './evaluation-worker?worker&url';

export class EvaluationStopped extends Error {}
export class EvaluationFailed extends Error {}
// Stuck means one started job exceeded STUCK_MS without progress, or a passive job was gated by that verdict.
// regex records whether retrying without bot regex may recover.
export class EvaluationStuck extends EvaluationFailed {
  constructor(message: string, readonly regex: boolean) {
    super(message);
  }
}

export function evaluationFailure(error: unknown): ApiFailure {
  if (error instanceof EvaluationStopped) return { ok: false, error: 'stopped' };
  if (error instanceof EvaluationStuck) return { ok: false, error: 'bot-stuck' };
  if (error instanceof EvaluationFailed) return { ok: false, error: 'evaluation-unavailable' };
  throw error;
}

export const evaluatingTask = <T>(work: Promise<T>): Promise<T | { kind: 'stopped' } | { kind: 'unsaved'; failure: ApiFailure }> =>
  work.catch((error: unknown) => {
    const failure = evaluationFailure(error);
    return failure.error === 'stopped' ? { kind: 'stopped' as const } : { kind: 'unsaved' as const, failure };
  });

// STUCK_MS bounds a stage/scan/count unit, not a whole long-chat pass (engine/progress).
// Before started/tokenizer load, use LOAD_MS only for a worker that cannot answer.
const STUCK_MS = 3_000;
const LOAD_MS = 20_000;
// Give the completed screen a paint before prefetching; a requested count loads immediately, without this delay.
const WARM_MS = 250;

// What a verdict on a job's chat (ChatProjections.verdict) does to it: a display runs without the bot's regex, a
// passive job is refused before it is posted, and a press runs as asked.
const GATES = {
  projection: 'display',
  screen: 'display',
  headless: 'display',
  forecast: 'passive',
  'cache-diagnosis': 'passive',
  memory: 'passive',
  view: 'passive',
  'auto-translation': 'passive',
  'auto-illustration': 'passive',
  mascot: 'passive',
  // A post agent's, which runs on its own after a reply; a pre agent's runs within the send.
  polish: 'passive',
  agent: 'press',
  send: 'press',
  translation: 'press',
  illustration: 'press',
  lore: 'press',
  tool: 'press',
  export: 'press',
  trial: 'press',
} as const;
type Asker = keyof typeof GATES;
// One job per caller/chat lane: replacement cancels the prior job. Retain history for changed-tail transport.
export type Lane<A extends Asker = Asker> = { asker: A; chat: string; tool?: string };
export type Verdicts = { verdict(chat: string): boolean; judged(chat: string): void };

type LooseJob =
  | { kind: 'patch'; owner: string; revision: number; generation: number; items: LuaResult[] }
  | { kind: 'count'; texts: string[] }
  | { kind: 'sample'; script: Omit<RegexScript, 'id'>; text: string };
type Work = { key: string; on: { chat: string; gate: (typeof GATES)[Asker] } | null; scope: ChatScope | null; regex: boolean; job: EvaluationJob | LooseJob; resolve: (result: EvaluationResult) => void; reject: (error: Error) => void; stop: () => void; signal?: AbortSignal };

const keyOf = ({ asker, chat, tool }: Lane) => `${asker}:${chat}${tool === undefined ? '' : `:${tool}`}`;
const onChat = ({ asker, chat }: Lane): Work['on'] => ({ chat, gate: GATES[asker] });
const bare = (scope: ChatScope): ChatScope => ({ ...scope, packs: scope.packs.map((pack) => ({ ...pack, regex: [] })) });

export class Evaluation {
  private worker: Worker | null = null;
  private warming: ReturnType<typeof setTimeout> | null = null;
  private warmed: Worker | null = null;
  private active: { id: number; work: Work; started: boolean } | null = null;
  private readonly waiting = new Map<string, Work>();
  private readonly histories = new Map<string, ChatScope['messages']>();
  private readonly heart = new Heartbeat(() => this.worker?.postMessage({ ping: true } satisfies EvaluationDown), () => this.silent());
  private ids = 0;
  private closed = false;

  constructor(private readonly verdicts: Verdicts) {}

  display(lane: Lane<'projection' | 'screen' | 'headless'>, scope: ChatScope, take: ReadonlySet<number>, signal?: AbortSignal, lua?: Extract<EvaluationJob, { kind: 'display' }>['lua']): Promise<DisplayEvaluation> {
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'display', take, ...(lua && { lua }) }, signal) as Promise<DisplayEvaluation>;
  }

  patch(lane: Lane<'screen'>, revision: number, generation: number, items: LuaResult[], signal?: AbortSignal): Promise<DisplayPatch | null> {
    return this.run(`patch:${keyOf(lane)}`, onChat(lane), null, { kind: 'patch', owner: keyOf(lane), revision, generation, items }, signal) as Promise<DisplayPatch | null>;
  }

  prompt(lane: Lane<'send' | 'forecast' | 'memory' | 'view'>, input: Omit<PromptInput, 'countTokens'>, signal?: AbortSignal): Promise<EvaluatedPrompt> {
    const { scope, ...rest } = input;
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'prompt', input: rest }, signal) as Promise<EvaluatedPrompt>;
  }

  cacheDiagnosis(chat: string, scope: ChatScope, input: CacheComparison, signal?: AbortSignal): Promise<CacheDiagnosis> {
    return this.once('cache-diagnosis', onChat({ asker: 'cache-diagnosis', chat }), scope, { kind: 'cache-diagnosis', input }, signal) as Promise<CacheDiagnosis>;
  }

  rewrite(lane: Lane<'send'>, scope: ChatScope, input: Omit<Extract<EvaluationJob, { kind: 'rewrite' }>, 'kind'>, signal?: AbortSignal): Promise<EvaluatedPrompt> {
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'rewrite', ...input }, signal) as Promise<EvaluatedPrompt>;
  }

  // On the send's own lane, after its rewrite: the worker holds the turn's history already.
  preread(lane: Lane<'send'>, input: Omit<PrereadInput, 'countTokens'>, signal?: AbortSignal): Promise<Counted<ReturnType<typeof assemblePreread>>> {
    const { scope, ...rest } = input;
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'preread', input: rest }, signal) as Promise<Counted<ReturnType<typeof assemblePreread>>>;
  }

  memory(lane: Lane<'memory'>, input: Omit<MemoryTaskInput, 'countTokens'>): Promise<Counted<ReturnType<typeof assembleMemory>>> {
    const { scope, ...rest } = input;
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'memory', input: rest }) as Promise<Counted<ReturnType<typeof assembleMemory>>>;
  }

  read(lane: Lane<'memory' | 'view'>, scope: ChatScope, memory: Extract<EvaluationJob, { kind: 'read' }>['memory']): Promise<Counted<ChatTexts>> {
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'read', memory }) as Promise<Counted<ChatTexts>>;
  }

  state(lane: Lane<'tool' | 'export'>, scope: ChatScope, prefix: string, signal?: AbortSignal): Promise<ToolState | RanAway> {
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'state', prefix }, signal) as Promise<ToolState | RanAway>;
  }

  variables(lane: Lane<'view' | 'trial'>, scope: ChatScope, prefix: string, signal?: AbortSignal): Promise<VariableInspection> {
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'variables', prefix }, signal) as Promise<VariableInspection>;
  }

  // A draft read after the chat (시험해 보기), on a lane of its own so it never stops 점검's.
  text(lane: Lane<'trial'>, scope: ChatScope, text: string, language: string | null, signal?: AbortSignal): Promise<TrialRead | RanAway> {
    return this.run(keyOf(lane), onChat(lane), scope, { kind: 'text', text, language }, signal) as Promise<TrialRead | RanAway>;
  }

  // A translation's, and a bot's lorebook read, may run beside others of the same chat: each has a lane of its own,
  // forgotten once it answers.
  translation(lane: Lane<'translation' | 'auto-translation'> | null, input: Omit<TranslationInput, 'countTokens'>, signal?: AbortSignal): Promise<Counted<ReturnType<typeof assembleTranslation>>> {
    const { scope, ...rest } = input;
    return this.once(lane?.asker ?? 'translation', lane && onChat(lane), scope, { kind: 'translation', input: rest }, signal) as Promise<Counted<ReturnType<typeof assembleTranslation>>>;
  }

  // Each its own lane, as a translation's: several messages' scenes may be written at once.
  illustration(lane: Lane<'illustration' | 'auto-illustration'>, input: Omit<IllustrationInput, 'countTokens'>, signal?: AbortSignal): Promise<Counted<ReturnType<typeof assembleIllustration>>> {
    const { scope, ...rest } = input;
    return this.once(lane.asker, onChat(lane), scope, { kind: 'illustration', input: rest }, signal) as Promise<Counted<ReturnType<typeof assembleIllustration>>>;
  }

  // Each its own lane, as an illustration's.
  mascot(lane: Lane<'mascot'>, input: Omit<MascotInput, 'countTokens'>, signal?: AbortSignal): Promise<Counted<ReturnType<typeof assembleMascot>>> {
    const { scope, ...rest } = input;
    return this.once(lane.asker, onChat(lane), scope, { kind: 'mascot', input: rest }, signal) as Promise<Counted<ReturnType<typeof assembleMascot>>>;
  }

  // Each its own lane, as a translation's: a turn's pre agents run at once.
  agent(lane: Lane<'agent' | 'polish'>, input: Omit<AgentInput, 'countTokens'>, signal?: AbortSignal): Promise<Counted<ReturnType<typeof assembleAgent>>> {
    const { scope, ...rest } = input;
    return this.once(lane.asker, onChat(lane), scope, { kind: 'agent', input: rest }, signal) as Promise<Counted<ReturnType<typeof assembleAgent>>>;
  }

  lore(lane: Lane<'lore'>, scope: ChatScope, seed: string, limit: number): Promise<Counted<{ role: 'system' | 'user' | 'assistant'; text: string }[] | RanAway>> {
    return this.once(lane.asker, onChat(lane), scope, { kind: 'lore', seed, limit }) as Promise<Counted<{ role: 'system' | 'user' | 'assistant'; text: string }[] | RanAway>>;
  }

  count(texts: string[]): Promise<Counted<number[]>> {
    return this.run(`count:${++this.ids}`, null, null, { kind: 'count', texts }) as Promise<Counted<number[]>>;
  }

  sample(key: string, script: Omit<RegexScript, 'id'>, text: string, signal?: AbortSignal): Promise<string> {
    return (this.run(key, null, null, { kind: 'sample', script, text }, signal) as Promise<{ sampled: string }>).then(({ sampled }) => sampled);
  }

  warm() {
    const worker = this.worker;
    if (this.closed || !worker || this.warmed === worker || this.warming !== null) return;
    this.warming = setTimeout(() => {
      this.warming = null;
      if (this.worker !== worker) return;
      this.warmed = worker;
      worker.postMessage({ warm: true } satisfies EvaluationDown);
    }, WARM_MS);
  }

  forget(lane: Lane) {
    this.drop(keyOf(lane));
  }

  close() {
    this.closed = true;
    this.end(new EvaluationStopped());
  }

  private drop(owner: string) {
    for (const key of [owner, `patch:${owner}`]) {
      const waiting = this.waiting.get(key);
      if (waiting) { this.waiting.delete(key); waiting.stop(); waiting.reject(new EvaluationStopped()); }
      if (this.active?.work.key === key) this.active.work.reject(new EvaluationStopped());
      this.histories.delete(key);
    }
    this.worker?.postMessage({ forget: owner } satisfies EvaluationDown);
  }

  private once(asker: Asker, on: Work['on'], scope: ChatScope, job: EvaluationJob, signal?: AbortSignal): Promise<EvaluationResult> {
    const key = `${asker}:${++this.ids}`;
    return this.run(key, on, scope, job, signal).finally(() => this.drop(key));
  }

  private run(key: string, on: Work['on'], scope: ChatScope | null, job: Work['job'], signal?: AbortSignal): Promise<EvaluationResult> {
    return new Promise((resolve, reject) => {
      if (this.closed || signal?.aborted) return reject(new EvaluationStopped());
      if (this.active?.work.key === key) this.active.work.reject(new EvaluationStopped());
      const old = this.waiting.get(key);
      if (old) { old.stop(); old.reject(new EvaluationStopped()); }
      const abort = () => {
        if (this.waiting.get(key) === work) this.waiting.delete(key);
        reject(new EvaluationStopped());
      };
      const work: Work = { key, on, scope, regex: true, job, resolve, reject, signal, stop: () => signal?.removeEventListener('abort', abort) };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.set(key, work);
      this.dispatch();
    });
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = moduleWorker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<EvaluationUp>) => this.receive(data);
    worker.onerror = worker.onmessageerror = () => this.end(new EvaluationFailed('Evaluation worker failed'));
    this.worker = worker;
    return worker;
  }

  private dispatch() {
    // Cancelling an executing synchronous pass cannot preempt it; keep its slot until the worker answers.
    if (this.active || this.closed) return;
    const work = this.next();
    if (!work) return this.heart.rest();
    const id = ++this.ids;
    this.active = { id, work, started: false };
    try {
      const worker = this.open();
      let input: EvaluationInput;
      if (work.job.kind === 'patch') input = { lane: work.job.owner, patch: { revision: work.job.revision, generation: work.job.generation, items: work.job.items } };
      else if (work.job.kind === 'count') input = { lane: work.key, count: work.job.texts };
      else if (work.job.kind === 'sample') input = { lane: work.key, sample: { script: work.job.script, text: work.job.text } };
      else {
        const { messages, ...scope } = work.scope!;
        input = { lane: work.key, scope, history: changedTail(this.histories.get(work.key) ?? [], messages, sameHistory), job: work.job };
        this.histories.set(work.key, messages);
      }
      // Before posting: a worker in this realm (tests) may say it started before postMessage returns.
      this.heart.start(LOAD_MS);
      worker.postMessage({ id, input } satisfies EvaluationDown);
    } catch (error) { this.end(new EvaluationFailed(String(error))); }
  }

  // The verdict is read as a job is posted, not as it is asked for, so one queued before its chat was judged is held
  // to it too.
  private next(): Work | undefined {
    for (;;) {
      const work = [...this.waiting.values()].find((work) => work.key.startsWith('send:')) ?? this.waiting.values().next().value;
      if (!work) return undefined;
      this.waiting.delete(work.key);
      if (!work.on || !this.verdicts.verdict(work.on.chat)) return work;
      if (work.on.gate === 'press') return work;
      if (work.on.gate === 'display') return work.scope ? { ...work, scope: bare(work.scope), regex: false } : work;
      work.stop();
      work.reject(new EvaluationStuck('refused under a verdict', false));
    }
  }

  private receive(data: EvaluationUp) {
    if ('pong' in data || 'progress' in data) return this.heart.answered();
    if ('trouble' in data) {
      autoDiagnose({ event: 'worker-trouble' });
      return noteProblem(data.trouble);
    }
    if ('probed' in data) return;
    const active = this.active;
    if ('started' in data) {
      if (active?.id !== data.started) return;
      active.started = true;
      this.heart.answered();
      this.heart.start(STUCK_MS);
      return;
    }
    if (!active || data.id !== active.id) return;
    this.active = null;
    active.work.stop();
    if ('error' in data) active.work.reject(new EvaluationFailed(data.error));
    else {
      // Structured cloning preserves Error but not a custom prototype; callers classify the engine's Runaway.
      if (data.result && 'stopped' in data.result && data.result.stopped) data.result.stopped = new Runaway();
      if (data.result && 'display' in data.result && data.result.display.stopped) data.result.display.stopped = new Runaway();
      active.work.resolve(data.result);
    }
    this.dispatch();
  }

  // A started job held the worker: only it fails, its chat is judged before anything else is posted, and the jobs
  // waiting go on in a new worker, which holds no history.
  private silent() {
    const active = this.active;
    if (!active?.started) return this.end(new EvaluationFailed('Evaluation worker stuck'));
    this.worker?.terminate();
    this.worker = null;
    this.cancelWarm();
    this.heart.rest();
    this.histories.clear();
    this.active = null;
    active.work.stop();
    active.work.reject(new EvaluationStuck('Evaluation worker stuck', active.work.regex));
    if (active.work.on) this.verdicts.judged(active.work.on.chat);
    this.dispatch();
  }

  private end(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.cancelWarm();
    this.heart.rest();
    const work = [...this.waiting.values(), ...(this.active ? [this.active.work] : [])];
    this.waiting.clear();
    this.active = null;
    this.histories.clear();
    for (const each of work) { each.stop(); each.reject(error); }
  }

  private cancelWarm() {
    if (this.warming !== null) clearTimeout(this.warming);
    this.warming = null;
    this.warmed = null;
  }
}
