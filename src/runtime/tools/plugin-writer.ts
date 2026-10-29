import { costUnit, resolveConnection } from '../../connectors/registry';
import { priceCost, sumCosts } from '../../connectors/pricing';
import type { Cost, ToolDef } from '../../connectors/types';
import { isRecord } from '../../connectors/values';
import { refOf, type ModelRef } from '../../connectors/assignment';
import { pluginAskMessages, readPluginAnswer, type PluginAnswer } from '../../engine/plugin-writer';
import type { Receipt } from '../../model/chat';
import api from '../../tool-api/hazelle.d.ts?raw';
import type { ApiFailure } from '../api';
import { sharedModel, type RouteFailure } from '../assignment';
import { retriesOf } from '../connections';
import type { Credentials } from '../credential';
import { gather, generate, receiptOf, unsettled } from '../generate';
import { modelProfile } from '../profiles';
import type { RequestLog } from '../request-log';
import type { ObjectStore } from '../store';
import { callOf, endCall, pageCall } from '../streams';
import type { Tokens } from '../token-calibration';
import type { ToolTrial } from '../script-preview';
import { toolLoop } from '../tool-loop';
import { keepRow } from '../usage';

type Deps = { store: ObjectStore; credentials: Credentials; log: RequestLog; tokens: Tokens };
// earlier: the draft's last asks, oldest first.
type Input = { body: string | null; ask: string; model: ModelRef | null; earlier?: { ask: string; note: string }[] };
// One run_test call as the studio's 테스트 ran it: the moment's label and how it ended, for the screen; report, for the
// model. unheard: the file has no handler for the moment's event. line: the body's.
export type TestStep = { moment: string; ended: 'passed' | 'unheard' | { failed: string; line: number | null }; report: string };
export type TestMoment = { moment: string; text: string };
// Made up by the model and put at the end of the test chat before the first moment.
export type TestMessage = { role: 'user' | 'assistant'; text: string };
// The studio's 테스트, on code the model wrote, one step per moment run, ending at the first failure.
export type PluginRunner = { run(code: string, moments: TestMoment[], messages: TestMessage[], signal: AbortSignal): Promise<TestStep[]> };
// One run_test call: what the model wrote in the reply that asked for it, '' after the reply's first run, and how many
// messages it made up.
export type TestRun = { said: string; added: number; steps: TestStep[] };
export type PluginAsked = { ok: true; answer: PluginAnswer; model: ModelRef; cost: Cost | null; runs: TestRun[] } | { ok: false; failure: RouteFailure | { kind: 'profile-missing'; own: boolean } | { kind: 'stopped' } | { kind: 'failed'; receipt: Receipt } | { kind: 'unsaved'; failure: ApiFailure } | { kind: 'too-many-calls' } };

// An ask's limits, the app's own whatever the model asks for: its test runs, and its calls with the answer's.
const RUNS = 3;
const CALLS = RUNS + 2;

// The moments are the code's own, not the draft's: a change may add the //@input or //@menu it then tests.
const RUN_TEST: ToolDef = {
  name: 'run_test',
  description: "Runs a version of the plugin file in the app's test on a real chat, at the moments given, in order, without installing or saving anything. What one moment leaves (chat state, storage, messages, variables) is there for the next, so list the moments of one use together. Stops at the first error. Answers what each moment showed and wrote, or the error with its line. The plugin's model calls are made only if the user allowed them; network calls and embeddings never are.",
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The whole file without the identity lines, as you would answer it.' },
      moments: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            moment: { type: 'string', description: 'reply: after the last reply is saved; sending: before a message is sent; prompt: when a request is built; menu:<id>, action:<id> (on the last message) or input:<id>, with an id from that line of the code.' },
            text: { type: 'string', description: 'The text typed, for the sending and input: moments.' },
          },
          required: ['moment'],
        },
      },
      messages: {
        type: 'array',
        description: 'Messages put at the end of the test chat before the first moment, as if sent, to test text of the shape the change reads; the reply moment then runs on the last of them that is a reply. Leave it out to run on the chat as it is.',
        items: {
          type: 'object',
          properties: { role: { type: 'string', enum: ['user', 'assistant'] }, text: { type: 'string' } },
          required: ['role', 'text'],
        },
      },
    },
    required: ['code', 'moments'],
  },
};

// What a run did, for the model: everything 테스트 lists, in plain words.
export function trialReport({ outcome, said, asked, calls, writes, called }: ToolTrial): string {
  const keys = (kind: 'storage' | 'setting') => writes.flatMap((write) => (write.kind === kind ? [write.key] : []));
  const value = outcome.value as Hazelle.PromptAnswer | undefined;
  const lines = [
    'Ran without an error.',
    typeof value === 'string' && `Answered text: ${JSON.stringify(value)}`,
    value && typeof value === 'object' && value.tool && `Plugin prompt block: ${JSON.stringify(value.tool)}`,
    value && typeof value === 'object' && value.memory && `Memory prompt block: ${JSON.stringify(value.memory.text)}`,
    said.length > 0 && `Showed: ${said.map(({ text }) => JSON.stringify(text)).join(', ')}`,
    asked.length > 0 && `Asked the user ${asked.length} question(s)`,
    outcome.tool?.badges.length && `Badges: ${outcome.tool.badges.map(({ text }) => JSON.stringify(text)).join(', ')}`,
    outcome.writes.length > 0 && `Chat state writes: ${outcome.writes.length}`,
    outcome.tool?.data.length && `Chat data writes: ${outcome.tool.data.map(([key]) => key).join(', ')}`,
    outcome.edits.length > 0 && `Message edits: ${outcome.edits.length}`,
    outcome.added.length > 0 && `Messages added: ${outcome.added.length}`,
    outcome.lore.length > 0 && `Chat lorebook entries: ${outcome.lore.length}`,
    keys('storage').length > 0 && `Storage writes: ${keys('storage').join(', ')}`,
    keys('setting').length > 0 && `Setting writes: ${keys('setting').join(', ')}`,
    ...writes.flatMap((write) => (write.kind === 'refused' ? [`Refused in a test: ${write.call}`] : [])),
    called.length > 0 && `Model calls made: ${called.length}`,
    calls.model > 0 && `Model calls refused (the user did not allow them in tests): ${calls.model}`,
    calls.embed > 0 && `Embeddings refused in a test: ${calls.embed}`,
    calls.fetch > 0 && `Network calls refused in a test: ${calls.fetch}`,
  ];
  return lines.filter((line): line is string => typeof line === 'string').join('\n');
}

// A run_test whose arguments are not of its shape is answered as such, never run on a guess.
function readTest(read: Record<string, unknown>): { code: string; moments: TestMoment[]; messages: TestMessage[] } | null {
  if (typeof read.code !== 'string' || !Array.isArray(read.moments) || read.moments.length === 0) return null;
  const listed = read.messages ?? [];
  if (!Array.isArray(listed)) return null;
  const moments = read.moments.flatMap((each: unknown) => (isRecord(each) && typeof each.moment === 'string' && (each.text === undefined || typeof each.text === 'string') ? [{ moment: each.moment, text: each.text ?? '' }] : []));
  const messages = listed.flatMap((each: unknown): TestMessage[] => (isRecord(each) && (each.role === 'user' || each.role === 'assistant') && typeof each.text === 'string' ? [{ role: each.role, text: each.text }] : []));
  return moments.length === read.moments.length && messages.length === listed.length ? { code: read.code, moments, messages } : null;
}

// With a runner, the model may test its file before answering: each of its calls is one model call, each run_test one
// trial, within RUNS and CALLS. The stop signal reaches the model call and the trial alike.
export async function askPlugin(deps: Deps, input: Input, signal: AbortSignal, onText: (text: string) => void, runner: PluginRunner | null = null, onRun: (run: TestRun) => void = () => {}): Promise<PluginAsked> {
  const { store, credentials, log, tokens } = deps;
  const route = sharedModel(store, 'main', input.model);
  if ('kind' in route) return { ok: false, failure: route };
  const profile = modelProfile(store, route.model);
  if (profile.kind === 'missing') return { ok: false, failure: { kind: 'profile-missing', own: profile.own } };
  const testing = runner && route.model.tools !== false ? runner : null;
  const messages = pluginAskMessages(api, input.body, input.ask, input.earlier, testing ? RUNS : 0);
  const runs: TestRun[] = [];
  const runTest = (testing: PluginRunner) => async (args: Record<string, unknown>, before: string) => {
    const asked = readTest(args);
    if (!asked) return 'Not run: the arguments are not a JSON object with a code string, a list of moments and, if any, a list of messages.';
    if (runs.length >= RUNS) return `Not run: the ${RUNS} test runs are used up. Answer now with the Korean note and the whole file.`;
    const steps = await testing.run(asked.code, asked.moments, asked.messages, signal);
    const run = { said: before.trim(), added: asked.messages.length, steps };
    runs.push(run);
    onRun(run);
    const reports = steps.map((step, at) => `${asked.moments[at]!.moment}:\n${step.report}`);
    return [...reports, ...(steps.length < asked.moments.length ? ['The run stopped there; the later moments did not run.'] : [])].join('\n\n');
  };
  const looped = await toolLoop({ tools: testing ? [{ def: RUN_TEST, run: runTest(testing) }] : [], rounds: CALLS, signal, onText: gather(onText).add }, async (exchange, tools, text) => {
    const call = await pageCall({ store, tokens }, route, 'script', null);
    try {
      const answer = await generate({
        credentials,
        log,
        connection: route.connection.value,
        model: route.model,
        settings: profile.profile.value.settings,
        retries: retriesOf(store, route.connection.value, profile.profile.value.settings),
        messages: [...messages, ...exchange],
        ...(tools && { tools }),
        call,
        signal,
        onText: text,
      });
      const receipt = unsettled(receiptOf(callOf(route), answer));
      const saved = await keepRow(store, receipt, Date.now(), { chat: null, character: null });
      return saved.ok ? { answer, receipt } : { kind: 'unsaved' as const, failure: saved };
    } finally {
      endCall(store, call.id);
    }
  });
  if (looped.kind === 'unsaved') return { ok: false, failure: looped };
  if (looped.kind === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
  if (looped.kind === 'exhausted') return { ok: false, failure: { kind: 'too-many-calls' } };
  const last = looped.rounds.at(-1)!;
  if (looped.kind === 'failed' || (!last.answer.calls.length && !last.text.trim())) return { ok: false, failure: { kind: 'failed', receipt: last.receipt } };
  const cost = sumCosts(looped.rounds.map(({ receipt }) => (receipt.cost === 'pending' ? null : receipt.cost)));
  return { ok: true, answer: readPluginAnswer(last.text), model: refOf(route.connection.id, route.model), cost, runs };
}

// One full file out: the current file's tokens, or 1,024 for a first draft, within the user's output cap. An estimate
// from the catalog price, never a quote: reasoning and cache hits are not foreseen.
export async function askEstimate(deps: Pick<Deps, 'store'>, input: Input): Promise<Cost | null> {
  const route = sharedModel(deps.store, 'main', input.model);
  if ('kind' in route || !route.model.price) return null;
  const profile = modelProfile(deps.store, route.model);
  if (profile.kind === 'missing') return null;
  const messages = pluginAskMessages(api, input.body, input.ask, input.earlier);
  const counts = await deps.store.evaluation.count([...messages.map(({ content }) => content), ...(input.body === null ? [] : [input.body])]).catch(() => null);
  if (!Array.isArray(counts)) return null;
  const fileTokens = input.body === null ? 1024 : counts.pop()!;
  const outputTokens = Math.min(fileTokens, profile.profile.value.settings.maxOutput ?? Infinity);
  return priceCost(route.model.price, { inputTokens: counts.reduce((sum, count) => sum + count, 0), outputTokens, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningTokens: null }, costUnit(resolveConnection(route.connection.value)?.type ?? null));
}
