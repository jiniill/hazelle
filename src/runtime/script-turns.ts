import type { ChatMessage } from '../connectors/types';
import type { Assembled, MemoryFill, PromptInput } from '../engine/pipeline';
import { toolWire } from '../engine/script-api';
import type { ChatScope } from '../engine/render';
import type { Writes } from '../model/chat';
import { live } from '../model/library';
import type { ToolUnit } from '../model/tool';
import type { ApiFailure } from './api';
import { packsOf, scopeOf } from './chat-context';
import { appendScripted, appendUserMessage, type Written } from './chat-log';
import { memoryOwner } from './memory-read';
import type { ReadModels } from './read-model';
import { noOutcome, ToolLate } from './script-binding';
import type { Anchor } from './script-effects';
import type { ScriptExecution } from './script-execution';
import { TOOL_DEADLINE_MS } from './script-execution';
import type { ScriptInteractions } from './script-interactions';
import { requestAnswer, requestEvent, sentBack, sentOf, toolRequest } from './script-request';
import type { ScriptSchedule } from './script-schedule';
import { scriptsOf, triggersOf } from './script-selection';
import { startStages } from './script-start';
import type { ObjectStore } from './store';
import type { Tool, ToolArgs } from './tool-loop';
import { toolsOf } from './tools/store';
import type { Blocked, TurnContext } from './turn-context';

export type Halted = { kind: 'halted' };
// turn: as it goes on. Its said is null once the user's message was saved here; a failure after that is kept
// (runtime/turn TurnFailure).
export type Started = { turn: TurnContext } | Halted | ((Blocked | { kind: 'gone' } | { kind: 'unsent'; failure: ApiFailure }) & { kept?: true });

// A tool's last prompt answer in this session: its slot text, and its memory with the id it stands through.
type Answered = { tool: string; memory: { text: string; through: string | null } | null };

// The bot's scripts in the life of a chat (design §6.8).
export class ScriptTurns {
  private readonly lastPrompt = new Map<string, Map<string, Answered>>();

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels },
    private readonly interactions: ScriptInteractions,
    private readonly schedule: ScriptSchedule,
    private readonly execution: ScriptExecution,
    private readonly closing: AbortSignal,
  ) {}

  prune() {
    const { store } = this.session;
    for (const [chat, last] of this.lastPrompt) {
      const stored = live(store.get('chat', chat));
      if (!stored || store.scopeState(chat) === 'unloaded') { this.lastPrompt.delete(chat); continue; }
      const active = new Set(toolsOf(store, stored.value).map(({ module, tool }) => `${module}:${tool.file.id}`));
      for (const key of last.keys()) if (!active.has(key)) last.delete(key);
      if (!last.size) this.lastPrompt.delete(chat);
    }
  }

  close() {
    this.lastPrompt.clear();
  }

  // The bot's scripts on the way to a reply (startStages), each saved as it lands. again gathers the turn anew once the
  // chat has changed under it: answer, once the user's message is saved and no longer sent.
  async starting(
    chat: string,
    first: TurnContext,
    again: (answer: boolean) => Promise<TurnContext | Blocked | { kind: 'unsent'; failure: ApiFailure } | null>,
    signal: AbortSignal,
  ): Promise<Started> {
    const scripts = triggersOf(packsOf(this.session.store, first.chat));
    const units = first.said ? this.execution.listening(first.chat, 'sending') : [];
    if (scripts.length === 0 && units.length === 0) return { turn: first };
    const halted: Halted = { kind: 'halted' };
    // 멈추기 ends the turn without waiting for a run that may itself be waiting, for a model or for the user. The
    // runs go on to where the user's message is saved, since they may already have written to the chat for it, and
    // no further; without triggers a turn stopped this early hands the text back instead.
    const stopped = new Promise<Halted>((resolve) => signal.addEventListener('abort', () => resolve(halted), { once: true }));
    const started = this.schedule.queued(chat, async (): Promise<Started> => {
      let turn = first;
      const regather = async (answer: boolean) => {
        const next = await again(answer);
        const failed = next === null ? ({ kind: 'gone' } as const) : 'kind' in next ? next : null;
        if (next && !('kind' in next)) turn = next;
        return failed && answer ? { ...failed, kept: true as const } : failed;
      };
      const { said } = first;
      const end = await startStages(said?.text ?? null, {
        scope: () => turn.scope,
        run: async (event, scope) => scripts.length ? this.execution.dispatch(chat, { lua: scripts, event }, scope, null) : { outcome: { ...noOutcome(), value: event.kind === 'edit' ? event.value : undefined }, changed: false },
        input: (text, scope) => this.execution.chained(chat, units, text, {
          event: (text) => ({ kind: 'sending', text }),
          scope: (writes) => ({ ...scope, pending: [...(scope.pending ?? []), ...writes] }),
          answer: (answered) => answered as string,
        }),
        changed: regather,
        send: async (text, before) => {
          const sent = await appendUserMessage(this.session.store, chat, { ...said!, text, ...(before.length > 0 && { before }) });
          return sent.ok ? null : ({ kind: 'unsent', failure: sent } as const);
        },
        aborted: () => signal.aborted,
      });
      if (end.kind === 'stopped') {
        const last = turn.scope.messages.at(-1);
        const saved = end.stage === 'onStart' && last && (await appendScripted(this.session.store, chat, { edits: [], removed: [], added: [], vars: { version: last.id, set: end.writes } }));
        if (saved && !saved.ok) this.interactions.note(chat, { kind: 'unsaved', failure: saved });
        if (end.stage === 'onInput' || end.stage === 'editInput') this.interactions.tell(chat, 'input-stop', { kind: 'input-stop' });
        return halted;
      }
      if (end.kind !== 'started') return end;
      const before = end.writes;
      return { turn: { ...turn, said: null, scope: { ...turn.scope, pending: before }, reply: { ...turn.reply, ...(before.length > 0 && { before }) } } };
    });
    // A message that could not be saved after the turn was stopped has nobody left to hear of it but the chat.
    void started.then((result) => signal.aborted && 'kind' in result && result.kind === 'unsent' && this.interactions.note(chat, { kind: 'unsaved', failure: result.failure }));
    return Promise.race([started, stopped]);
  }

  // editRequest: the bot's Lua, then each tool's requesting. Only the chat's own requests pass here; a script's or a
  // tool's model call, memory and translation do not. running: told each tool's name as it starts.
  async requesting(chat: string, turn: TurnContext, prompt: Pick<Assembled, 'messages' | 'parts'>, signal: AbortSignal, running: (name: string) => void): Promise<{ messages: ChatMessage[]; writes: Writes }> {
    const scripts = scriptsOf(packsOf(this.session.store, turn.chat));
    const units = this.execution.listening(turn.chat, 'requesting');
    if (scripts.length === 0 && units.length === 0) return { messages: prompt.messages, writes: [] };
    return this.schedule.queued(chat, async () => {
      let sent = sentOf(prompt);
      let writes: Writes = [];
      if (scripts.length) {
        const { outcome } = await this.execution.dispatch(chat, { lua: scripts, event: requestEvent(sent) }, turn.scope, null);
        sent = requestAnswer(outcome, sent);
        writes = outcome.writes;
      }
      const tooled = await this.execution.chained(chat, units, sent, {
        event: (sent) => ({ kind: 'requesting', messages: toolRequest(sent) }),
        scope: (more) => ({ ...turn.scope, pending: [...(turn.scope.pending ?? []), ...writes, ...more] }),
        answer: (answered, sent) => sentBack(sent, answered as unknown[], 'message'),
        turn: { signal, running },
      });
      return { messages: tooled.value.map(({ message }) => message), writes: [...writes, ...tooled.writes] };
    });
  }

  // editOutput: the bot's Lua, then each tool's replying in pack order, each handing the next the text it left.
  async ending(chat: string, reply: Written): Promise<Written> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? scriptsOf(packsOf(this.session.store, stored.value)) : [];
    const units = stored ? this.execution.listening(stored.value, 'replying') : [];
    if (!stored || (scripts.length === 0 && units.length === 0) || reply.receipt.state === 'failed') return reply;
    return this.schedule.queued(chat, async () => {
      const messages = this.session.read.chat(chat).snapshot()?.messages ?? [];
      const at = reply.message === null ? -1 : messages.findIndex((message) => message.id === reply.message);
      const scope = scopeOf(this.session, chat, stored.value, at === -1 ? messages : messages.slice(0, at));
      let text = reply.text;
      let before = reply.before ?? [];
      if (scripts.length) {
        // The reply stands right after the scope, a version made anew or continued at its message's place.
        const index = scope.messages.length - (scope.greeting === null ? 0 : 1);
        const { outcome } = await this.execution.dispatch(chat, { lua: scripts, event: { kind: 'edit', stage: 'editOutput', value: text, meta: { index } } }, { ...scope, pending: before }, null);
        before = [...before, ...outcome.writes];
        if (typeof outcome.value === 'string') text = outcome.value;
      }
      const lua = before;
      const tooled = await this.execution.chained(chat, units, text, {
        event: (text) => ({ kind: 'replying', text }),
        scope: (writes) => ({ ...scope, pending: [...lua, ...writes] }),
        answer: (answered) => answered as string,
      });
      text = tooled.value;
      before = [...before, ...tooled.writes];
      return { ...reply, text, ...(before.length > 0 && { before }) };
    });
  }

  // onOutput, once the reply is saved. What it writes is the reply version's.
  async ended(chat: string, reply: Written): Promise<void> {
    if (reply.receipt.state === 'failed') return;
    await this.execution.now(chat, { kind: 'output' }, (): Anchor => ({ version: reply.id }));
    this.execution.replyTools(chat, reply);
  }

  // What a send now would hold from the chat's tools, by their last answers in this session: the forecast's.
  cachedPrompt(chat: string, turn: Pick<TurnContext, 'scope' | 'memory'>): Pick<PromptInput, 'tools' | 'memory'> {
    const stored = live(this.session.store.get('chat', chat));
    if (!stored) return { tools: [], memory: turn.memory };
    const last = (unit: ToolUnit) => this.lastPrompt.get(chat)?.get(`${unit.module}:${unit.tool.file.id}`);
    const tools = toolsOf(this.session.store, stored.value).flatMap((unit) => {
      const text = last(unit)?.tool;
      return text?.trim() ? [{ module: unit.module, name: unit.tool.manifest.displayName, text }] : [];
    });
    const owner = memoryOwner(this.session.store, stored.value);
    const memory = owner?.kind === 'tool' && last(owner.unit)?.memory;
    return { tools, memory: memory ? this.memoryOf(chat, owner.unit, turn.scope, memory) : turn.memory };
  }

  // Each tool's prompt event, in pack order, under a deadline: its slot text after the history, and for the one holding
  // the memory slot, its memory in the slot's own place (design §6.10).
  async prompting(chat: string, first: TurnContext, again: () => ReturnType<Parameters<ScriptTurns['starting']>[2]>, signal: AbortSignal): Promise<Started & { tools: PromptInput['tools'] }> {
    const units = toolsOf(this.session.store, first.chat);
    if (units.length === 0) return { turn: first, tools: [] };
    const owner = memoryOwner(this.session.store, first.chat);
    const holder = owner?.kind === 'tool' ? owner.unit : null;
    return this.schedule.queued(chat, async () => {
      const tools: PromptInput['tools'] = [];
      const writes: Writes = [];
      let turn = first;
      let remembered: Answered['memory'] = null;
      for (const unit of units) {
        if (signal.aborted || this.closing.aborted) break;
        const from = { kind: 'module', id: unit.module } as const;
        const holds = unit.module === holder?.module;
        if (!holds && holder && unit.tool.manifest.uses.includes('memory') && this.session.store.get('module', unit.module)?.value.takesMemory) this.interactions.tell(chat, 'memory-held', { kind: 'memory-held', by: holder.tool.manifest.displayName }, from);
        const key = `${unit.module}:${unit.tool.file.id}`;
        const last = this.lastPrompt.get(chat) ?? new Map<string, Answered>();
        this.lastPrompt.set(chat, last);
        const deadline = new AbortController();
        const stop = AbortSignal.any([signal, this.closing, deadline.signal]);
        const timer = setTimeout(() => deadline.abort(new ToolLate()), TOOL_DEADLINE_MS);
        try {
          const scope = { ...turn.scope, pending: [...(first.scope.pending ?? []), ...writes] };
          const { outcome, changed } = await this.execution.dispatch(chat, { tool: unit, event: { kind: 'prompt', turn: { memory: holds } } }, scope, null, stop, () => clearTimeout(timer));
          writes.push(...outcome.writes);
          if (stop.aborted) {
            // The memory it last gave still stands, as memory changes only at a boundary; recall is of the turn.
            const kept = last.get(key)?.memory ?? null;
            if (holds) remembered = kept;
            if (kept) last.set(key, { tool: '', memory: kept });
            else last.delete(key);
            continue;
          }
          if (changed) {
            const next = await again();
            if (!next) return { kind: 'gone' as const, tools };
            if ('kind' in next) return { ...next, tools };
            turn = next;
          }
          const answer = outcome.value as Hazelle.PromptAnswer | undefined;
          const text = (typeof answer === 'object' && answer !== null ? answer.tool : answer) ?? '';
          const memory = holds && typeof answer === 'object' && answer?.memory ? answer.memory : null;
          if (holds) remembered = memory;
          last.set(key, { tool: text, memory });
          if (text.trim()) tools.push({ module: unit.module, name: unit.tool.manifest.displayName, text });
        } finally { clearTimeout(timer); }
      }
      const memory = holder && remembered ? this.memoryOf(chat, holder, turn.scope, remembered, true) : turn.memory;
      return { tools, turn: { ...turn, memory, scope: { ...turn.scope, pending: [...(first.scope.pending ?? []), ...writes] }, reply: { ...turn.reply, before: [...(first.reply.before ?? []), ...writes] } } };
    });
  }

  // The turn's //@tool tools, each run in the chat's script queue on the turn's chat as the calls before it left it, with
  // no deadline: the turn's stop ends it. Its state writes gather in writes, which the reply is saved with. null: no
  // plugin of the chat has one.
  calling(chat: string, turn: TurnContext, signal: AbortSignal): { tools: Tool[]; writes: Writes } | null {
    const units = toolsOf(this.session.store, turn.chat).filter(({ tool }) => tool.manifest.functions?.length);
    if (units.length === 0) return null;
    const writes: Writes = [];
    const run = (unit: ToolUnit, name: string) => (args: ToolArgs) => this.schedule.queued(chat, async () => {
      const scope = { ...turn.scope, pending: [...(turn.scope.pending ?? []), ...writes] };
      const { outcome } = await this.execution.dispatch(chat, { tool: unit, event: { kind: 'tool', name, args } }, scope, null, AbortSignal.any([signal, this.closing]));
      writes.push(...outcome.writes);
      if (typeof outcome.value === 'string') return outcome.value;
      const [error] = outcome.errors;
      return error ? `The tool failed: ${'message' in error ? error.message : 'it ran too long'}` : outcome.handled ? 'The tool answered nothing.' : 'The tool did not run: its plugin has no tool handler.';
    });
    const tools = units.flatMap((unit, at) => unit.tool.manifest.functions!.map(({ name, description, parameters }) => ({ def: { name: toolWire(at, name), description, parameters }, run: run(unit, name) })));
    return { tools, writes };
  }

  // The last message a request always sends as it is (design §6.2), and one the chat does not hold, stand for nothing:
  // the text goes, and no message leaves for it.
  private memoryOf(chat: string, unit: ToolUnit, scope: ChatScope, memory: NonNullable<Answered['memory']>, tell = false): MemoryFill {
    const at = memory.through === null ? -1 : scope.messages.findIndex((message) => message.message === memory.through);
    const through = at === scope.messages.length - 1 ? -1 : at;
    if (tell && memory.through !== null && through === -1) this.interactions.tell(chat, 'memory-through', { kind: 'failed', message: 'memory.through names no message before the last' }, { kind: 'module', id: unit.module });
    return { kind: 'tool', name: unit.tool.manifest.displayName, text: memory.text, through };
  }
}
