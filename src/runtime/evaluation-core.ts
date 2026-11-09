import { cacheDiagnosis } from '../engine/cache-diagnosis';
import type { CacheComparison, CacheDiagnosis } from '../model/cache';
import { rewritten, type ProviderFit } from '../engine/prompt-budget';
import type { CbsTrace } from '../engine/cbs/evaluate';
import { DisplayPass, onboardingPage, type Display, type DisplayPatch, type DisplayWork } from '../engine/display';
import { speakersOf, standing, type Standing } from '../engine/memory';
import { activeLore, assemble, assembleAgent, assembleIllustration, assembleMascot, assembleMemory, assemblePreread, assembleTranslation, renderAfter, type AgentInput, type Assembled, type IllustrationInput, type MascotInput, type MemoryTaskInput, type PrereadInput, type PromptInput, type RanAway, type TranslationInput } from '../engine/pipeline';
import type { RegexScript } from '../engine/import/types';
import { trySample } from '../engine/regex/scripts';
import { inspectVariables, renderChat, type VariableInspection, type ChatBasis, type ChatScope, type LuaDisplay } from '../engine/render';
import type { Memory, Source } from '../model/memory';
import { applyTail, type Tail } from './history-delta';
import { tokenizer } from './tokenizer';

type LuaText = { text: string; stamp: string; shown: string };
const stamped = (generation: number, stamp: string) => `${generation}/${stamp}`;
export type EvaluationJob =
  | { kind: 'cache-diagnosis'; input: CacheComparison }
  | { kind: 'display'; take: ReadonlySet<number>; lua?: { generation: number; revision: number; waits: boolean } }
  | { kind: 'prompt'; input: Omit<PromptInput, 'scope' | 'countTokens'> }
  | { kind: 'rewrite'; prompt: Assembled; messages: Parameters<typeof rewritten>[1]; fit: ProviderFit | null }
  | { kind: 'translation'; input: Omit<TranslationInput, 'scope' | 'countTokens'> }
  | { kind: 'memory'; input: Omit<MemoryTaskInput, 'scope' | 'countTokens'> }
  | { kind: 'illustration'; input: Omit<IllustrationInput, 'scope' | 'countTokens'> }
  | { kind: 'mascot'; input: Omit<MascotInput, 'scope' | 'countTokens'> }
  | { kind: 'preread'; input: Omit<PrereadInput, 'scope' | 'countTokens'> }
  | { kind: 'agent'; input: Omit<AgentInput, 'scope' | 'countTokens'> }
  | { kind: 'read'; memory: { memory: Memory; shown: Source[]; budget: number } | null }
  | { kind: 'lore'; seed: string; limit: number }
  | { kind: 'state'; prefix: string }
  | { kind: 'variables'; prefix: string }
  | { kind: 'text'; text: string; language: string | null }
  | { kind: 'onboarding'; html: string };
export type LuaResult = LuaText & { version: string };
export type TrialRead = CbsTrace & { read: string };
export type OnboardingPage = ReturnType<typeof onboardingPage>;
export type EvaluationInput =
  | { lane: string; scope: ChatBasis; history: Tail<ChatScope['messages'][number]>; job: EvaluationJob }
  | { lane: string; patch: { revision: number; generation: number; items: LuaResult[] } }
  | { lane: string; count: string[] }
  | { lane: string; sample: { script: Omit<RegexScript, 'id'>; text: string } };
export type DisplayEvaluation = { display: Display; work: DisplayWork | null };
// Every count is made here, in the worker, the only realm that loads the tokenizer.
export type Counted<T> = T | { kind: 'tokenizer' };
export type EvaluatedPrompt = Counted<ReturnType<typeof assemble>>;
export type ChatTexts = { texts: string[]; tokens: number[]; standing: Standing | null };
// staged: each message past its input or output stage (renderChat), which a Risu chat file holds.
export type ToolState = { texts: string[]; staged: string[]; variables: [string, string][]; wrote: [string, string][][] };
export type EvaluationResult =
  | CacheDiagnosis
  | ToolState
  | VariableInspection
  | DisplayEvaluation
  | DisplayPatch
  | EvaluatedPrompt
  | Counted<ReturnType<typeof assembleTranslation> | ReturnType<typeof assembleMemory> | ReturnType<typeof assembleIllustration> | ReturnType<typeof assembleMascot> | ReturnType<typeof assemblePreread> | ReturnType<typeof assembleAgent> | ChatTexts | { role: 'system' | 'user' | 'assistant'; text: string }[] | RanAway | number[]>
  | { sampled: string }
  | TrialRead
  | OnboardingPage
  | null;
// probe: 문제 진단's check, sent to a worker of its own: whether the tokenizer loads, and what stopped it if not.
export type EvaluationDown = { id: number; input: EvaluationInput } | { forget: string } | { warm: true } | { ping: true } | { probe: true };
// started: the job's pass over the chat began, past loading the tokenizer. progress: the pass is still moving
// (engine/progress). trouble: why the tokenizer did not load, for 문제 진단's recent problems (runtime/diagnostics).
export type EvaluationUp = { id: number; result: EvaluationResult } | { id: number; error: string } | { pong: true } | { started: number } | { progress: true } | { trouble: string } | { probed: string };

export class Evaluator {
  private readonly displays = new Map<string, { revision: number; pass: DisplayPass }>();
  private readonly held = new Map<string, Map<string, LuaText>>();
  private readonly histories = new Map<string, ChatScope['messages']>();

  forget(lane: string) { this.histories.delete(lane); this.displays.delete(lane); this.held.delete(lane); }

  async run(input: EvaluationInput, started: () => void): Promise<EvaluationResult> {
    if ('patch' in input) {
      started();
      const current = this.displays.get(input.lane);
      if (!current) return null;
      const held = this.held.get(input.lane)!;
      for (const item of input.patch.items) held.set(item.version, { text: item.text, stamp: stamped(input.patch.generation, item.stamp), shown: item.shown });
      if (current.revision !== input.patch.revision) return null;
      const patch = current.pass.patch(input.patch.items.map(({ version, shown }) => ({ version, text: shown })));
      if (!patch.pass) this.displays.delete(input.lane);
      return patch;
    }
    if ('count' in input) {
      const countTokens = await tokenizer().catch(() => null);
      if (!countTokens) return { kind: 'tokenizer' };
      started();
      return input.count.map(countTokens);
    }
    if ('sample' in input) {
      started();
      return { sampled: trySample(input.sample.script, input.sample.text) };
    }
    const { lane, scope: data, history, job } = input;
    const messages = applyTail(this.histories.get(lane) ?? [], history);
    this.histories.set(lane, messages);
    const scope: ChatScope = { ...data, messages };
    if (job.kind === 'cache-diagnosis') {
      started();
      return cacheDiagnosis(job.input, scope);
    }
    if (job.kind === 'variables') {
      started();
      return inspectVariables(scope, job.prefix);
    }
    if (job.kind === 'text') {
      started();
      const trace: CbsTrace = { steps: [], omitted: 0 };
      const read = renderAfter(scope, job.text, { seed: 'trial' }, job.language, trace);
      return typeof read === 'string' ? { read, ...trace } : read;
    }
    if (job.kind === 'onboarding') {
      started();
      return onboardingPage(scope, job.html);
    }
    if (job.kind === 'state') {
      started();
      const { texts, staged, variables, wrote, stopped } = renderChat('prompt', scope);
      if (stopped) return { kind: 'runaway' };
      return { texts, staged, variables: [...variables].filter(([key]) => key.startsWith(job.prefix)), wrote };
    }
    if (job.kind !== 'display') {
      const countTokens = await tokenizer().catch(() => null);
      if (!countTokens) return { kind: 'tokenizer' };
      started();
      switch (job.kind) {
        case 'rewrite':
          return rewritten(job.prompt, job.messages, countTokens, job.fit);
        case 'prompt':
          return assemble({ ...job.input, scope: scope as PromptInput['scope'], countTokens });
        case 'translation':
          return assembleTranslation({ ...job.input, scope, countTokens });
        case 'memory':
          return assembleMemory({ ...job.input, scope, countTokens });
        case 'illustration':
          return assembleIllustration({ ...job.input, scope, countTokens });
        case 'mascot':
          return assembleMascot({ ...job.input, scope, countTokens });
        case 'preread':
          return assemblePreread({ ...job.input, scope, countTokens });
        case 'agent':
          return assembleAgent({ ...job.input, scope, countTokens });
        case 'read': {
          const { texts } = renderChat('prompt', scope);
          const sent = job.memory && standing(job.memory.memory, { shown: job.memory.shown, roles: messages.map(({ role }) => role), speakers: speakersOf(scope), texts }, job.memory.budget, countTokens);
          return { texts, tokens: texts.map((text) => countTokens(text.trim())), standing: sent };
        }
        case 'lore': {
          const lore = activeLore(scope, job.seed, countTokens);
          if ('kind' in lore) return lore;
          let total = 0;
          const fitting: typeof lore = [];
          for (const entry of lore) {
            total += countTokens(entry.text);
            if (total > job.limit) break;
            fitting.push(entry);
          }
          return fitting;
        }
      }
    }
    started();
    const lua = job.lua;
    const held = this.held.get(lane) ?? new Map<string, LuaText>();
    if (lua) this.held.set(lane, held);
    const edited: LuaDisplay | undefined = lua && ((version, text, stamp) => {
      const had = held.get(version);
      return had ? { text: had.shown, fresh: had.text === text && had.stamp === stamped(lua.generation, stamp) } : lua.waits ? null : { text, fresh: false };
    });
    // CBS can read later messages and threads variables forward: always display the whole chat, never only its tail.
    const pass = new DisplayPass(scope, job.take, edited);
    if (lua && pass.work) this.displays.set(lane, { revision: lua.revision, pass });
    else this.displays.delete(lane);
    if (!lua) this.held.delete(lane);
    return { display: pass.value, work: pass.work };
  }
}
