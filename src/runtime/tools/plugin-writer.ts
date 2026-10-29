import { costUnit, resolveConnection } from '../../connectors/registry';
import { priceCost, sumCosts } from '../../connectors/pricing';
import type { Cost, ToolCall, ToolDef, ToolResult } from '../../connectors/types';
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
import { keepRow } from '../usage';

type Deps = { store: ObjectStore; credentials: Credentials; log: RequestLog; tokens: Tokens };
type Input = { body: string | null; ask: string; model: ModelRef | null };
// One run_test call as the studio's 테스트 ran it: the moment's label and how it ended, for the screen; report, for the
// model. unheard: the file has no handler for the moment's event. line: the body's.
export type TestStep = { moment: string; ended: 'passed' | 'unheard' | { failed: string; line: number | null }; report: string };
// The studio's 테스트, on code the model wrote; absent where there is no draft to run it as (a first draft).
export type PluginRunner = { run(code: string, moment: string, text: string, signal: AbortSignal): Promise<TestStep> };
export type PluginAsked = { ok: true; answer: PluginAnswer; model: ModelRef; cost: Cost | null; steps: TestStep[] } | { ok: false; failure: RouteFailure | { kind: 'profile-missing'; own: boolean } | { kind: 'stopped' } | { kind: 'failed'; receipt: Receipt } | { kind: 'unsaved'; failure: ApiFailure } | { kind: 'too-many-calls' } };

// An ask's limits, the app's own whatever the model asks for: its test runs, and its calls with the answer's.
const RUNS = 3;
const CALLS = RUNS + 2;

// The moments are the code's own, not the draft's: a change may add the //@input or //@menu it then tests.
const RUN_TEST: ToolDef = {
  name: 'run_test',
  description: "Runs a version of the plugin file once in the app's test on a real chat, at one moment, without installing or saving anything. Answers what the run showed and wrote, or its error with the line. The plugin's model calls are made only if the user allowed them; network calls and embeddings never are.",
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The whole file without the identity lines, as you would answer it.' },
      moment: { type: 'string', description: 'reply: after the last reply is saved; sending: before a message is sent; prompt: when a request is built; menu:<id>, action:<id> (on the last message) or input:<id>, with an id from that line of the code.' },
      text: { type: 'string', description: 'The text typed, for the sending and input: moments.' },
    },
    required: ['code', 'moment'],
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

// A call the model made with arguments that do not read is answered as such, never run on a guess.
function readTest(call: ToolCall): { code: string; moment: string; text: string } | null {
  try {
    const read: unknown = JSON.parse(call.arguments);
    if (typeof read !== 'object' || read === null) return null;
    const { code, moment, text = '' } = read as Record<string, unknown>;
    return typeof code === 'string' && typeof moment === 'string' && typeof text === 'string' ? { code, moment, text } : null;
  } catch {
    return null;
  }
}

// With a runner, the model may test its file before answering: each of its calls is one model call, each run_test one
// trial, within RUNS and CALLS. The stop signal reaches the model call and the trial alike.
export async function askPlugin(deps: Deps, input: Input, signal: AbortSignal, onText: (text: string) => void, runner: PluginRunner | null = null, onStep: (step: TestStep) => void = () => {}): Promise<PluginAsked> {
  const { store, credentials, log, tokens } = deps;
  const route = sharedModel(store, 'main', input.model);
  if ('kind' in route) return { ok: false, failure: route };
  const profile = modelProfile(store, route.model);
  if (profile.kind === 'missing') return { ok: false, failure: { kind: 'profile-missing', own: profile.own } };
  const testing = runner && route.model.tools !== false ? runner : null;
  const messages = pluginAskMessages(api, input.body, input.ask, testing ? RUNS : 0);
  const tools = testing ? [RUN_TEST] : undefined;
  const costs: (Cost | null)[] = [];
  const steps: TestStep[] = [];
  for (let calls = 0; calls < CALLS; calls++) {
    if (signal.aborted) return { ok: false, failure: { kind: 'stopped' } };
    const call = await pageCall({ store, tokens }, route, 'script', null);
    const text = gather(onText);
    try {
      const answer = await generate({
        credentials,
        log,
        connection: route.connection.value,
        model: route.model,
        settings: profile.profile.value.settings,
        retries: retriesOf(store, route.connection.value, profile.profile.value.settings),
        messages,
        ...(tools && { tools }),
        call,
        signal,
        onText: text.add,
      });
      const receipt = unsettled(receiptOf(callOf(route), answer));
      const saved = await keepRow(store, receipt, Date.now(), { chat: null, character: null });
      if (!saved.ok) return { ok: false, failure: { kind: 'unsaved', failure: saved } };
      costs.push(receipt.cost === 'pending' ? null : receipt.cost);
      if (answer.cut === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
      if (answer.state === 'failed' || (!answer.calls.length && !text.value().trim())) return { ok: false, failure: { kind: 'failed', receipt } };
      if (!answer.calls.length || !testing) return { ok: true, answer: readPluginAnswer(text.value()), model: refOf(route.connection.id, route.model), cost: sumCosts(costs), steps };
      const results: ToolResult[] = [];
      for (const each of answer.calls) {
        const asked = each.name === 'run_test' ? readTest(each) : null;
        let result: string;
        if (!asked) result = `Not run: ${each.name === 'run_test' ? 'the arguments are not a JSON object with code and moment strings' : 'there is no such tool'}.`;
        else if (steps.length >= RUNS) result = `Not run: the ${RUNS} test runs are used up. Answer now with the Korean note and the whole file.`;
        else {
          const step = await testing.run(asked.code, asked.moment, asked.text, signal);
          if (signal.aborted) return { ok: false, failure: { kind: 'stopped' } };
          steps.push(step);
          onStep(step);
          result = step.report;
        }
        results.push({ id: each.id, name: each.name, text: result });
      }
      messages.push({ role: 'assistant', content: text.value(), calls: answer.calls }, { role: 'user', content: '', results });
    } finally {
      endCall(store, call.id);
    }
  }
  return { ok: false, failure: { kind: 'too-many-calls' } };
}

// One full file out: the current file's tokens, or 1,024 for a first draft, within the user's output cap. An estimate
// from the catalog price, never a quote: reasoning and cache hits are not foreseen.
export async function askEstimate(deps: Pick<Deps, 'store'>, input: Input): Promise<Cost | null> {
  const route = sharedModel(deps.store, 'main', input.model);
  if ('kind' in route || !route.model.price) return null;
  const profile = modelProfile(deps.store, route.model);
  if (profile.kind === 'missing') return null;
  const messages = pluginAskMessages(api, input.body, input.ask);
  const counts = await deps.store.evaluation.count([...messages.map(({ content }) => content), ...(input.body === null ? [] : [input.body])]).catch(() => null);
  if (!Array.isArray(counts)) return null;
  const fileTokens = input.body === null ? 1024 : counts.pop()!;
  const outputTokens = Math.min(fileTokens, profile.profile.value.settings.maxOutput ?? Infinity);
  return priceCost(route.model.price, { inputTokens: counts.reduce((sum, count) => sum + count, 0), outputTokens, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningTokens: null }, costUnit(resolveConnection(route.connection.value)?.type ?? null));
}
