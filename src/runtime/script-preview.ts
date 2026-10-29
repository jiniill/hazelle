import type { ModelRef } from '../connectors/assignment';
import type { ChatMessage, Cost } from '../connectors/types';
import type { HistoryMessage } from '../engine/history';
import type { HookTrace, SyntaxProblem } from '../engine/lua/run';
import type { ChatScope } from '../engine/render';
import type { Event, Question, ScriptUnit, ToolEvent, ToolReach } from '../engine/script-api';
import { answerInstructionOf, packsOf } from './chat-context';
import type { EvaluatedPrompt } from './evaluation-core';
import type { ScriptOutcome } from './lua/event';
import { memoryOver } from './memory-read';
import { ToolStopped, until, type LuaRunner } from './script-binding';
import type { ScriptReach } from './script-reach';
import { requestAnswer, requestEvent, sentOf } from './script-request';
import { triggersOf } from './script-selection';
import { startStages, type StartStage } from './script-start';
import type { ScriptTurns } from './script-turns';
import type { DraftTrial } from './tools/drafts';
import type { TrialWrite } from './tools/frame-state';
import type { ToolRunner } from './tools/host';
import type { ObjectStore } from './store';
import { providerFit } from './token-calibration';
import type { Sending } from './turn-context';

// Preview applies staged edits/adds and chat-local lore replacement as a real ScriptEffects save would.
// Caller places variable writes at their correct stages.
export function applied(chat: string, scope: ChatScope, { edits, removed, added, lore }: ScriptOutcome): ChatScope {
  if (!edits.length && !removed.length && !added.length && !lore.length) return scope;
  const greeting = scope.greeting === null ? 0 : 1;
  const edited = new Map(edits.map((edit) => [edit.index + greeting, edit]));
  const gone = new Set(removed.map((index) => index + greeting));
  const ahead = (at: number | null) => added.filter(({ before }) => (before === null ? null : before + greeting) === at).map(({ role, text }): HistoryMessage => {
    const id = crypto.randomUUID();
    return { id, message: id, seed: id, role: role === 'user' ? 'user' : 'assistant', text, time: Date.now(), staged: true };
  });
  const messages = [
    ...scope.messages.flatMap((message, at) => {
      const edit = edited.get(at);
      const before = [...(message.before ?? []), ...(edit?.wrote ?? [])];
      const kept = edit ? { ...message, id: crypto.randomUUID(), text: edit.text, staged: true as const, ...(before.length > 0 && { before }) } : message;
      return [...ahead(at), ...(gone.has(at) ? [] : [kept])];
    }),
    ...ahead(null),
  ];
  const written = new Map(lore.map((entry) => [entry.name, entry]));
  const placed = new Set<string>();
  const held = scope.lore.flatMap((entry) => {
    const value = entry.parent === chat ? written.get(entry.value.name) : undefined;
    if (!value) return [entry];
    if (placed.has(value.name)) return [];
    placed.add(value.name);
    return [{ ...entry, value }];
  });
  const fresh = lore.filter(({ name }) => !placed.has(name)).map((value) => ({ id: crypto.randomUUID(), parent: chat, value }));
  const last = held.findLastIndex(({ parent }) => parent === chat) + 1 || held.length;
  return { ...scope, messages, lore: [...held.slice(0, last), ...fresh, ...held.slice(last)] };
}

// Dismiss preview questions and refuse calls without saving; real execution may branch differently.
// loreRanAway means the script read no lore after CBS exceeded its limit.
export type Heard = { said: { tone: 'normal' | 'error'; text: string }[]; asked: Question[]; calls: { model: number; embed: number; background: number; fetch: number }; loreRanAway: boolean };

// The pre-send scripts run ahead on a copy (ScriptPreview.rehearse). stopped: the stage that ended the turn, which then sends
// nothing. scope: the chat as onStart leaves it, its writes and then editRequest's pending. input: the message as
// editInput left it, null when unchanged. prompt: the request built after onStart, null when it is the forecast's.
// request: what editRequest answered, null when it left the request as given. changed: the request sent would differ
// from the forecast's.
export type Rehearsal = Heard & {
  trace: HookTrace;
  stopped: StartStage | null;
  scope: ChatScope;
  input: string | null;
  prompt: EvaluatedPrompt | null;
  request: ChatMessage[] | null;
  changed: boolean;
};

// One trigger run alone for one event (ScriptPreview.trial), as 시험해 보기 shows it.
export type Trial = Heard & { outcome: ScriptOutcome };
// A studio draft run alone for one event (ScriptPreview.tool), as its 테스트 shows it. called: each model call made, by
// its cost.
export type ToolTrial = Trial & { writes: TrialWrite[]; called: (Cost | null)[] };

export const NOT_REHEARSED = 'Error: not called while rehearsing';
const unheard = (): Heard => ({ said: [], asked: [], calls: { model: 0, embed: 0, background: 0, fetch: 0 }, loreRanAway: false });

export class ScriptPreview {
  constructor(
    private readonly session: { store: ObjectStore },
    private readonly lua: () => Promise<LuaRunner>,
    private readonly reach: ScriptReach,
    private readonly turns: Pick<ScriptTurns, 'cachedPrompt'>,
    private readonly tools: Pick<ToolRunner, 'trial'>,
  ) {}

  // A Lua draft's first syntax error, from the same VM that runs it; unchecked when the worker is gone.
  check(code: string): Promise<SyntaxProblem | null | 'unchecked'> {
    return this.lua().then((runner) => runner.check(code)).catch(() => 'unchecked' as const);
  }

  // Use separate Lua engines off the send queue; never save or log rehearsal effects.
  // Dismiss questions/refuse model calls, so real branching can differ. Never rehearse tools: storage writes are real.
  // Null means no triggers.
  async rehearse(chat: string, { turn, prompt, calibration }: Sending, signal: AbortSignal): Promise<Rehearsal | null> {
    const scripts = triggersOf(packsOf(this.session.store, turn.chat));
    if (scripts.length === 0) return null;
    const trace: HookTrace = { entries: [], omitted: 0 };
    const heard = unheard();
    let scope = turn.scope;
    let touched = false;
    let input: string | null = null;
    const run = async (event: Event, at: ChatScope) => {
      const outcome = await until(this.lua().then((runner) => runner.run(chat, scripts, at, event, this.quiet(chat, at, heard, signal), 'preview', signal)), signal);
      trace.entries.push(...(outcome.trace?.entries ?? []));
      trace.omitted += outcome.trace?.omitted ?? 0;
      const next = applied(chat, at, outcome);
      if (next !== at) {
        touched = true;
        scope = { ...scope, messages: [...next.messages, ...scope.messages.slice(at.messages.length)], lore: next.lore };
      }
      return { outcome, changed: next !== at };
    };
    const end = await startStages<never>(turn.said?.text ?? null, {
      scope: () => scope,
      run,
      input: async (value) => ({ value, writes: [] }),
      changed: async () => null,
      send: async (text, before) => {
        const last = scope.messages.at(-1)!;
        if (text !== last.text) input = text;
        if (text !== last.text || before.length > 0) {
          touched = true;
          scope = { ...scope, messages: [...scope.messages.slice(0, -1), { ...last, text, ...(before.length > 0 && { before }) }] };
        }
        return null;
      },
      aborted: () => signal.aborted,
    });
    if (end.kind === 'stopped' && end.stage === null) throw new ToolStopped();
    if (end.writes.length > 0) {
      touched = true;
      scope = { ...scope, pending: end.writes };
    }
    const rehearsal = () => ({ ...heard, trace, scope, input, prompt: null, request: null, changed: false });
    if (end.kind === 'stopped') return { ...rehearsal(), stopped: end.stage };
    const built = touched ? await this.session.store.evaluation.prompt({ asker: 'view', chat }, { scope, seed: turn.reply.id, budget: turn.budget, fit: providerFit(turn.route, turn.settings, calibration.fit.allowance), ...this.turns.cachedPrompt(chat, { scope, memory: memoryOver(turn.memory, scope.messages) }), continuing: false, answerInstruction: answerInstructionOf(this.session.store), pictures: turn.pictures }, signal) : prompt;
    const after = 'kind' in built || JSON.stringify(built.messages) !== JSON.stringify(prompt.messages) ? built : null;
    if ('kind' in built) return { ...rehearsal(), stopped: null, prompt: after, changed: true };
    const edited = await run(requestEvent(sentOf(built)), scope);
    if (edited.outcome.writes.length > 0) scope = { ...scope, pending: [...end.writes, ...edited.outcome.writes] };
    const request = edited.outcome.trace?.entries.some((entry) => entry.changed) ? requestAnswer(edited.outcome, sentOf(built)).map(({ message }) => message) : null;
    return { ...rehearsal(), stopped: null, prompt: after, request, changed: after !== null || request !== null };
  }

  // chat: the one scope is read from, or 'sample'. Each run has an owner of its own, so it starts on fresh Lua globals.
  async trial(chat: string, scope: ChatScope, unit: ScriptUnit, event: Event, signal: AbortSignal): Promise<Trial> {
    const heard = unheard();
    const outcome = await until(this.lua().then((runner) => runner.run(`trial:${crypto.randomUUID()}`, [unit], scope, event, this.quiet(chat, scope, heard, signal), 'preview', signal)), signal);
    return { ...heard, outcome };
  }

  // calling: the model its 모델 부르기 calls (null: the 보조 모델), or null while off, which refuses the calls as any
  // rehearsal does. null: the draft does not listen to the event.
  async tool(chat: string, scope: ChatScope, draft: DraftTrial, event: ToolEvent, calling: { model: ModelRef | null } | null, signal: AbortSignal): Promise<ToolTrial | null> {
    const heard = unheard();
    const called: (Cost | null)[] = [];
    const quiet = this.quiet(chat, scope, heard, signal);
    const host: ToolReach = calling ? { ...quiet, model: async (_role, messages) => { const { result, cost } = await this.reach.tried(calling.model, messages, signal); called.push(cost); return result; } } : quiet;
    const ran = await this.tools.trial(chat, draft, scope, event, host, signal);
    return ran && { ...heard, ...ran, called };
  }

  // A host for a run that saves nothing: each question dismissed, each model, embedding, background and network call
  // refused.
  private quiet(chat: string, scope: ChatScope, heard: Heard, signal: AbortSignal): ToolReach {
    return {
      ...this.reach.reads(chat, scope, () => { heard.loreRanAway = true; }),
      say: (tone, text) => { if (!signal.aborted) heard.said.push({ tone, text }); },
      ask: async (question) => { if (!signal.aborted) heard.asked.push(question); return null; },
      model: async () => { heard.calls.model++; return { success: false, reason: 'failed', result: NOT_REHEARSED }; },
      embed: async () => { heard.calls.embed++; return { ok: false, reason: 'failed' }; },
      background: async () => { heard.calls.background++; return false; },
      fetch: async () => { heard.calls.fetch++; return { ok: false, reason: 'stopped' }; },
    };
  }
}
