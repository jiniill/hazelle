import type { CacheComparison } from '../model/cache';
import { afterEach, expect, it, vi } from 'vitest';
import { display } from '../engine/display';
import type { ChatScope } from '../engine/render';
import { Evaluation, EvaluationFailed, EvaluationStopped, EvaluationStuck, type Verdicts } from './evaluation';
import { Evaluator, type EvaluationDown, type EvaluationUp } from './evaluation-core';
import { changedTail, sameHistory } from './history-delta';

const scope: ChatScope = { card: null, cast: [], packs: [], persona: null, prompt: null, note: null, lore: [], loreFolders: {}, loreScan: { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false }, messages: [], variables: [], greeting: null, toggles: new Map(), model: null, axModel: null, clock: { now: 0, timeZone: 'UTC' }, assets: [], inlays: [], textfiles: [], modules: [], faces: { char: null, user: null }, screen: null, pick: '' };
const message = (id: string, text: string) => ({ id, message: id, seed: id, role: 'user' as const, text, time: 0 });
const none: Verdicts = { verdict: () => false, judged: () => {} };
const screen = (chat = 'c') => ({ asker: 'screen', chat }) as const;

type Fake = { posted: EvaluationDown[]; ended: boolean; receive(data: EvaluationUp): void };
function fakeWorkers(log: string[] = []) {
  const workers: Fake[] = [];
  vi.stubGlobal('Worker', class implements Fake {
    onmessage: ((event: { data: EvaluationUp }) => void) | null = null;
    posted: EvaluationDown[] = [];
    ended = false;
    constructor() { workers.push(this); }
    postMessage(data: EvaluationDown) {
      this.posted.push(data);
      if ('input' in data) log.push(`posted ${data.input.lane}`);
    }
    terminate() { this.ended = true; }
    receive(data: EvaluationUp) { this.onmessage?.({ data }); }
  });
  const jobs = (worker: Fake) => worker.posted.flatMap((data) => 'input' in data ? [data] : []);
  return { workers, jobs };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('defers tokenizer warming until a worker exists, warms once, and cancels on close', async () => {
  vi.useFakeTimers();
  const { workers, jobs } = fakeWorkers();
  const evaluation = new Evaluation(none);
  evaluation.warm();
  expect(workers).toHaveLength(0);
  const showing = evaluation.display(screen(), scope, new Set());
  const worker = workers[0]!;
  const job = jobs(worker)[0]!;
  worker.receive({ id: job.id, result: await new Evaluator().run(job.input, () => {}) });
  await showing;
  evaluation.warm();
  evaluation.warm();
  expect(worker.posted.filter((message) => 'warm' in message)).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(250);
  evaluation.warm();
  await vi.advanceTimersByTimeAsync(250);
  expect(worker.posted.filter((message) => 'warm' in message)).toHaveLength(1);
  evaluation.close();

  const abandoned = new Evaluation(none);
  const waiting = expect(abandoned.display(screen(), scope, new Set())).rejects.toBeInstanceOf(EvaluationStopped);
  abandoned.warm();
  abandoned.close();
  await waiting;
  await vi.advanceTimersByTimeAsync(250);
  expect(workers[1]!.posted.some((message) => 'warm' in message)).toBe(false);
});

it('replays old tail reads and forward variables after a history delta, and matches the engine', async () => {
  const evaluation = new Evaluation(none);
  const first = { ...scope, messages: [message('old', '{{setvar::hp::7}}tail={{lastmessage}}'), message('tail', '{{getvar::hp}} old')] };
  expect((await evaluation.display(screen(), first, new Set())).display).toEqual(display(first));
  const next = { ...first, messages: [first.messages[0]!, message('tail', '{{getvar::hp}} new')] };
  const result = await evaluation.display(screen(), next, new Set());
  expect(result.display).toEqual(display(next));
  expect(result.display.texts).toEqual(['tail=7 new', '7 new']);
  evaluation.close();
});

it('reads a draft after the chat, with the variables its messages leave', async () => {
  const evaluation = new Evaluation(none);
  const chat = { ...scope, variables: [['a', '1']], messages: [message('m', '{{setvar::a::2}}')] } satisfies ChatScope;
  expect(await evaluation.text({ asker: 'trial', chat: 'c' }, chat, 'a={{getvar::a}}', null)).toEqual({ read: 'a=2', steps: [{ at: 2, end: 15, depth: 0, result: '2', variable: 'a' }], omitted: 0 });
  evaluation.close();
});

it('runs a regex sample in the worker, as the engine would on the screen', async () => {
  const evaluation = new Evaluation(none);
  const script = { name: '', find: 'cat', replace: 'dog', stage: 'display' as const, flags: null, off: true as const };
  expect(await evaluation.sample('sample:a', script, 'a cat')).toBe('a dog');
  evaluation.close();
});

it('coalesces queued revisions, settles cancellations and retains the active slot until its reply', async () => {
  const { workers, jobs } = fakeWorkers();
  const engine = new Evaluator();
  const evaluation = new Evaluation(none);
  const stop = new AbortController();
  const first = evaluation.display(screen(), { ...scope, messages: [message('a', 'first')] }, new Set(), stop.signal);
  const cancelled = expect(first).rejects.toBeInstanceOf(EvaluationStopped);
  stop.abort();
  await cancelled;
  const old = evaluation.display(screen(), { ...scope, messages: [message('a', 'obsolete')] }, new Set());
  const obsolete = expect(old).rejects.toBeInstanceOf(EvaluationStopped);
  const latest = evaluation.display(screen(), { ...scope, messages: [message('a', 'latest')] }, new Set());
  await obsolete;
  const requests = () => jobs(workers[0]!);
  expect(requests()).toHaveLength(1);
  workers[0]!.receive({ id: requests()[0]!.id, result: await engine.run(requests()[0]!.input, () => {}) });
  expect(requests()).toHaveLength(2);
  workers[0]!.receive({ id: requests()[1]!.id, result: await engine.run(requests()[1]!.input, () => {}) });
  expect((await latest).display.texts).toEqual(['latest']);
  const closing = evaluation.display(screen(), scope, new Set());
  const closed = expect(closing).rejects.toBeInstanceOf(EvaluationStopped);
  evaluation.close();
  await closed;
});

it('does not let an older Lua patch cancel a newer whole-input revision', async () => {
  const evaluation = new Evaluation(none);
  const first = await evaluation.display(screen(), { ...scope, messages: [message('a', 'one')] }, new Set(), undefined, { revision: 1, generation: 1, waits: true });
  const item = first.work!.items[0]!;
  const next = evaluation.display(screen(), { ...scope, messages: [message('a', 'two')] }, new Set(), undefined, { revision: 2, generation: 2, waits: true });
  const old = evaluation.patch(screen(), 1, 1, [{ version: 'a', text: item.text, stamp: item.stamp, shown: 'obsolete' }]);
  expect((await next).display.texts).toEqual(['']);
  expect(await old).toBeNull();
  evaluation.close();
});

it('ends a worker that cannot answer before its job starts, failing every job and judging no chat', async () => {
  vi.useFakeTimers();
  const { workers } = fakeWorkers();
  const judged = vi.fn();
  const evaluation = new Evaluation({ verdict: () => false, judged });
  const loading = expect(evaluation.display(screen(), scope, new Set())).rejects.toBeInstanceOf(EvaluationFailed);
  const queued = expect(evaluation.display(screen('d'), scope, new Set())).rejects.toBeInstanceOf(EvaluationFailed);
  await vi.advanceTimersByTimeAsync(19_000);
  expect(workers[0]!.ended).toBe(false);
  await vi.advanceTimersByTimeAsync(6_000);
  await loading;
  await queued;
  expect(workers[0]!.ended).toBe(true);
  expect(judged).not.toHaveBeenCalled();
  evaluation.close();
});

it('keeps a started job alive while it gives signs of life, and through a beat that came late', async () => {
  vi.useFakeTimers();
  const { workers, jobs } = fakeWorkers();
  const evaluation = new Evaluation(none);
  const running = evaluation.display(screen(), scope, new Set());
  const worker = workers[0]!;
  const { id } = jobs(worker)[0]!;
  worker.receive({ started: id });
  for (let second = 0; second < 6; second++) {
    await vi.advanceTimersByTimeAsync(1_000);
    worker.receive({ progress: true });
  }
  await vi.advanceTimersByTimeAsync(1_000);
  // The page held for five seconds: the answer to the ping it sent waits behind that, so it pings again, not judges.
  vi.setSystemTime(Date.now() + 5_000);
  await vi.advanceTimersByTimeAsync(1_000);
  worker.receive({ pong: true });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(worker.ended).toBe(false);
  worker.receive({ id, result: await new Evaluator().run(jobs(worker)[0]!.input, () => {}) });
  expect((await running).display.texts).toEqual([]);
  evaluation.close();
});

it('kills only a started job that goes silent, judges its chat before the next is posted, and goes on afresh', async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  const { workers, jobs } = fakeWorkers(log);
  const engine = new Evaluator();
  const evaluation = new Evaluation({ verdict: () => false, judged: (chat) => log.push(`judged ${chat}`) });
  const messages = [message('a', 'one'), message('b', 'two')];
  const before = evaluation.display(screen('d'), { ...scope, messages }, new Set());
  const old = workers[0]!;
  old.receive({ id: jobs(old)[0]!.id, result: await engine.run(jobs(old)[0]!.input, () => {}) });
  await before;
  const stuck = expect(evaluation.display({ asker: 'projection', chat: 'c' }, scope, new Set())).rejects.toMatchObject({ constructor: EvaluationStuck, regex: true });
  old.receive({ started: jobs(old)[1]!.id });
  const next = { ...scope, messages: [...messages, message('c', 'three')] };
  const waiting = evaluation.display(screen('d'), next, new Set());
  await vi.advanceTimersByTimeAsync(5_000);
  await stuck;
  expect(old.ended).toBe(true);
  expect(log.slice(-2)).toEqual(['judged c', 'posted screen:d']);
  const fresh = workers[1]!;
  const job = jobs(fresh)[0]!;
  expect('history' in job.input && job.input.history).toEqual(changedTail([], next.messages, sameHistory));
  // Timed from its own start, not from the ping the killed job left unanswered.
  await vi.advanceTimersByTimeAsync(17_000);
  expect(fresh.ended).toBe(false);
  fresh.receive({ started: job.id });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fresh.ended).toBe(false);
  fresh.receive({ id: job.id, result: await new Evaluator().run(job.input, () => {}) });
  expect((await waiting).display.texts).toEqual(['one', 'two', 'three']);
  evaluation.close();
});

it('judges a started job that goes silent in a hidden tab, whose every beat comes late', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  const { workers, jobs } = fakeWorkers();
  const evaluation = new Evaluation(none);
  const running = expect(evaluation.display(screen(), scope, new Set())).rejects.toBeInstanceOf(EvaluationStuck);
  const worker = workers[0]!;
  worker.receive({ started: jobs(worker)[0]!.id });
  await vi.advanceTimersByTimeAsync(1_000);
  vi.setSystemTime(Date.now() + 60_000);
  await vi.advanceTimersByTimeAsync(1_000);
  await running;
  expect(worker.ended).toBe(true);
  evaluation.close();
});

it('says a display that went silent without the regex ran without it', async () => {
  vi.useFakeTimers();
  const { workers, jobs } = fakeWorkers();
  const evaluation = new Evaluation({ verdict: () => true, judged: () => {} });
  const running = expect(evaluation.display({ asker: 'projection', chat: 'c' }, scope, new Set())).rejects.toMatchObject({ constructor: EvaluationStuck, regex: false });
  const worker = workers[0]!;
  worker.receive({ started: jobs(worker)[0]!.id });
  await vi.advanceTimersByTimeAsync(5_000);
  await running;
  evaluation.close();
});

it('holds a job to its chat\'s verdict as it is posted: a passive one is refused, a display leaves the regex out, a press runs', async () => {
  const { workers, jobs } = fakeWorkers();
  const stuck = new Set<string>();
  const evaluation = new Evaluation({ verdict: (chat) => stuck.has(chat), judged: () => {} });
  const packs = [{ regex: [{ id: 'x', name: 'x', find: 'a', replace: 'b', stage: 'display' as const, flags: null }], triggers: [], toggles: [] }];
  const ahead = evaluation.display(screen('x'), scope, new Set());
  const queued = evaluation.display({ asker: 'projection', chat: 'c' }, { ...scope, packs }, new Set());
  const asked = evaluation.read({ asker: 'view', chat: 'c' }, scope, null);
  stuck.add('c');
  const worker = workers[0]!;
  worker.receive({ id: jobs(worker)[0]!.id, result: null });
  await ahead;
  const posted = jobs(worker);
  expect('scope' in posted[1]!.input && posted[1]!.input.scope.packs).toEqual([{ ...packs[0], regex: [] }]);
  worker.receive({ id: posted[1]!.id, result: null });
  await queued;
  await expect(asked).rejects.toBeInstanceOf(EvaluationStuck);
  const translation = { scope, take: new Set<number>(), prompt: { name: '', blocks: [], toggles: [], task: 'translate' as const }, translations: [], notes: '', request: { kind: 'input' as const, text: 'hi' }, language: 'Korean', seed: 's' };
  await expect(evaluation.translation({ asker: 'auto-translation', chat: 'c' }, translation)).rejects.toBeInstanceOf(EvaluationStuck);
  const pressed = evaluation.translation({ asker: 'translation', chat: 'c' }, translation);
  expect(jobs(worker).map(({ input }) => input.lane)).toEqual(['screen:x', 'projection:c', expect.stringMatching(/^translation:/)]);
  evaluation.close();
  await expect(pressed).rejects.toBeInstanceOf(EvaluationStopped);
});

it('reads tool state lazily from the prompt replay, filters its namespace, and replays changed tails', async () => {
  const evaluation = new Evaluation(none);
  const prefix = 'tool:jin/notes:';
  const first = { ...scope, messages: [message('a', '{{setvar::tool:jin/notes:count::1}}hello {{getvar::tool:jin/notes:count}}')], variables: [['private', 'secret'], ['tool:other/tool:key', 'hidden']] as [string, string][] };
  const lane = { asker: 'tool', chat: 'c', tool: 'm' } as const;
  const read = await evaluation.state(lane, first, prefix);
  expect(read).toMatchObject({ texts: ['hello 1'], variables: [[`${prefix}count`, '1']] });
  const next = { ...first, messages: [...first.messages, message('b', '{{setvar::tool:jin/notes:count::2}}next')], pending: [[`${prefix}pending`, '3']] as [string, string][] };
  expect(await evaluation.state(lane, next, prefix)).toMatchObject({ texts: ['hello 1', 'next'], variables: [[`${prefix}count`, '2'], [`${prefix}pending`, '3']] });
  evaluation.close();
});

it('logs state read timing over a 1000-message history without asserting a wall-clock budget', async () => {
  const evaluation = new Evaluation(none);
  const history = { ...scope, messages: Array.from({ length: 1000 }, (_, index) => message(String(index), `Message ${index}. {{setvar::tool:jin/memory:turn::${index}}} ${'A traveler walks toward the old lighthouse. '.repeat(12)}`)) };
  const lane = { asker: 'tool', chat: 'timing', tool: 'memory' } as const;
  const samples: number[] = [];
  for (let read = 0; read < 15; read++) {
    const start = performance.now();
    await evaluation.state(lane, history, 'tool:jin/memory:');
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.info(JSON.stringify({ measurement: 'tool-state', fixture: 'synthetic-1000-message-CBS-history', messages: history.messages.length, reads: samples.length, p50Ms: samples[7], p95Ms: samples[14] }));
  evaluation.close();
});

it('returns provenance only for an explicitly requested variables job', async () => {
  const evaluation = new Evaluation(none);
  try {
    const history = { ...scope, variables: [['n', '0']] as [string, string][], messages: [message('v', '{{addvar::n::1}}')], pending: [['n', '2']] as [string, string][] };
    const state = await evaluation.state({ asker: 'tool', chat: 'c', tool: 'tool' }, history, 'n');
    expect(state).not.toHaveProperty('history');
    const inspected = await evaluation.variables({ asker: 'view', chat: 'c' }, history, 'n');
    expect(inspected.variables[0]!.history.map(({ writer, value }) => [writer.kind, value])).toEqual([['chat', '0'], ['cbs', '1'], ['pending', '2']]);
    expect(inspected.variables[0]!.last.value).toBe('2');
  } finally { evaluation.close(); }
});

it('runs diagnosis on one disposable worker lane and aborts it with the forecast controller', async () => {
  const { workers } = fakeWorkers();
  const evaluation = new Evaluation(none);
  const controller = new AbortController();
  const input: CacheComparison = { forecast: { parts: [], removed: [], written: 0, tail: 0, against: { read: 0, of: 10, broken: { kind: 'expired' } } }, before: null, after: { prompt: { messages: [], parts: [], lore: null, silent: null, invalidKeys: [], loreBudget: 0, memory: null, dropped: 0, problems: { found: [], omitted: 0 }, unseen: 0 }, wire: [] } };
  const diagnosis = evaluation.cacheDiagnosis('c', scope, input, controller.signal);
  expect(workers[0]!.posted.filter((data) => 'input' in data).map(({ input }) => 'job' in input && input.job.kind)).toEqual(['cache-diagnosis']);
  controller.abort();
  await expect(diagnosis).rejects.toBeInstanceOf(EvaluationStopped);
  expect(workers[0]!.posted.some((message) => 'forget' in message)).toBe(true);
  evaluation.close();
});
