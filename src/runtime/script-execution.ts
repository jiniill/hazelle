import type { ChatScope } from '../engine/render';
import type { Event, ScriptUnit, ToolEvent, ToolReach } from '../engine/script-api';
import type { Chat } from '../model/chat';
import type { Writes } from '../model/chat';
import { live, type PackOwner } from '../model/library';
import type { ToolUnit } from '../model/tool';
import type { EventName } from '../tool-api/protocol';
import { packsOf, scopeOf } from './chat-context';
import { replyMessage, type Written } from './chat-log';
import type { ScriptOutcome } from './lua/event';
import type { ReadModels } from './read-model';
import { noOutcome, ToolLate, ToolStopped, until, type Binding, type LuaRunner } from './script-binding';
import type { Anchor, ScriptEffects } from './script-effects';
import type { ScriptJournal } from './script-journal';
import type { ScriptReach } from './script-reach';
import type { ScriptSchedule } from './script-schedule';
import { atOf, scopeFor, triggersOf } from './script-selection';
import type { ObjectStore } from './store';
import type { Tools } from './tools/facade';
import { toolsOf } from './tools/store';

type Units = { lua: ScriptUnit[]; event: Event } | { tool: ToolUnit; event: ToolEvent };

const ownerOf = (units: Units): PackOwner | null => 'tool' in units ? { kind: 'module', id: units.tool.module } : null;

// A tool's answer in a stage a turn or a display waits on (prompt, sending, replying, showing); one that misses it is cut
// off and the turn goes on. requesting has none (Chained.turn).
export const TOOL_DEADLINE_MS = 5000;

// A step of the tools' chain (ScriptExecution.chained). scope: the chat as the step sees it, after the writes of the tools
// before it. answer: what a tool answered makes of the value, an Error when it cannot. quiet: nothing it does is saved.
// turn: a step the turn waits on as on its pre agents, with no deadline: ended by 멈추기, told each tool's name as it
// starts, and free to ask for a card.
type Chained<T> = { event(value: T): ToolEvent; scope(writes: Writes): ChatScope; answer(answered: unknown, value: T): T | Error; quiet?: true; turn?: { signal: AbortSignal; running(name: string): void } };

export class ScriptExecution {
  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels },
    private readonly bindings: { lua: () => Promise<LuaRunner>; tools: Binding<ToolUnit, ToolEvent, ToolReach> & Pick<Tools, 'hears'> },
    private readonly schedule: ScriptSchedule,
    private readonly reach: ScriptReach,
    private readonly effects: ScriptEffects,
    private readonly journal: ScriptJournal,
    private readonly closing: AbortSignal,
  ) {}

  // The chat's tools that may answer showing (ScriptDisplay).
  showers(chat: Chat): ToolUnit[] {
    return this.listening(chat, 'showing');
  }

  // editDisplay's tools, after the bot's Lua, over one stretch of a display pass; nothing they do is saved.
  async showing(chat: string, units: ToolUnit[], scope: ChatScope, items: { version: string; text: string }[]): Promise<string[]> {
    const greeting = scope.greeting === null ? 0 : 1;
    const places = new Map(scope.messages.map((message, at) => [message.id, at]));
    const shown = items.map(({ version, text }): Hazelle.Shown => {
      const at = places.get(version)!;
      return { at: at < greeting ? null : { index: at - greeting, id: scope.messages[at]!.message, version }, text };
    });
    const { value } = await this.chained(chat, units, items.map(({ text }) => text), {
      event: (texts) => ({ kind: 'showing', shown: shown.map((each, at) => ({ ...each, text: texts[at]! })) }),
      scope: () => scope,
      answer: (answered, texts) => (answered as string[]).length === texts.length ? answered as string[] : new Error(`showing answered ${(answered as string[]).length} texts for ${texts.length} messages`),
      quiet: true,
    });
    return value;
  }

  // Each tool in pack order, after the bot's Lua, under the deadline, handed what the one before it left; one that
  // misses the deadline is cut off and the value passes on as it came.
  async chained<T>(chat: string, units: ToolUnit[], first: T, step: Chained<T>): Promise<{ value: T; writes: Writes }> {
    let value = first;
    let writes: Writes = [];
    for (const unit of units) {
      if (this.closing.aborted || step.turn?.signal.aborted) break;
      const deadline = new AbortController();
      const stop = AbortSignal.any([this.closing, step.turn?.signal ?? deadline.signal]);
      const timer = step.turn ? undefined : setTimeout(() => deadline.abort(new ToolLate()), TOOL_DEADLINE_MS);
      const ended = step.turn ? undefined : () => clearTimeout(timer);
      step.turn?.running(unit.tool.manifest.displayName);
      try {
        const run = { tool: unit, event: step.event(value) };
        const outcome = step.quiet ? await this.run(chat, run, step.scope(writes), stop, true).finally(ended) : (await this.dispatch(chat, run, step.scope(writes), null, stop, ended)).outcome;
        if (stop.aborted) continue;
        writes = [...writes, ...outcome.writes];
        const next = outcome.value === undefined ? value : step.answer(outcome.value, value);
        if (next instanceof Error) this.journal.report(chat, next, { kind: 'module', id: unit.module });
        else value = next;
      } finally { clearTimeout(timer); }
    }
    return { value, writes };
  }

  // A tool whose frame has not loaded yet may listen.
  listening(chat: Chat, event: EventName): ToolUnit[] {
    return toolsOf(this.session.store, chat).filter(({ module }) => this.bindings.tools.hears(module, event) !== false);
  }

  replyTools(chat: string, reply: Written) {
    const stored = live(this.session.store.get('chat', chat));
    if (!stored || this.closing.aborted) return;
    const units = toolsOf(this.session.store, stored.value);
    if (!units.length) return;
    const scope = scopeFor(this.session, chat);
    const at = atOf(scope, replyMessage(reply));
    // The saved reply's snapshot and anchor travel with this job, even if another version is shown before it runs.
    if (at) for (const unit of units) void this.schedule.lane(chat, unit, () => this.dispatch(chat, { tool: unit, event: { kind: 'reply', reply: { ...at, version: reply.id } } }, scope, { version: reply.id }, this.closing));
  }

  now(chat: string, event: Event, anchor: (scope: ChatScope) => Anchor | null, begun?: () => void): Promise<boolean | null> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? triggersOf(packsOf(this.session.store, stored.value)) : [];
    if (!stored || scripts.length === 0) return Promise.resolve(null);
    return this.schedule.queued(chat, async () => {
      begun?.();
      const scope = scopeOf(this.session, chat, stored.value, this.session.read.chat(chat).snapshot()?.messages ?? []);
      const { outcome } = await this.dispatch(chat, { lua: scripts, event }, scope, anchor(scope));
      return outcome.handled;
    });
  }

  // deadline: the run is under a tool deadline, ended by this once the run ends.
  async dispatch(chat: string, units: Units, scope: ChatScope, anchor: Anchor | null, signal?: AbortSignal, deadline?: () => void) {
    const outcome = await this.run(chat, units, scope, signal, deadline !== undefined).finally(deadline);
    return this.effects.event(chat, scope, outcome, anchor, ownerOf(units), units.event.kind === 'reply' ? units.event.reply.version : undefined);
  }

  // A run that cannot be made (a worker that would not start, a script that held it) leaves the chat as it was.
  private async run(chat: string, units: Units, scope: ChatScope, signal?: AbortSignal, deadline = false): Promise<ScriptOutcome> {
    const began = performance.now();
    const at = Date.now();
    const { event } = units;
    const nothing = { ...noOutcome(), value: event.kind === 'edit' ? event.value : undefined };
    if (this.closing.aborted || signal?.aborted) return nothing;
    const from = ownerOf(units);
    try {
      const host = this.reach.host(chat, scope, signal, deadline);
      const running = 'lua' in units
        ? this.bindings.lua().then((runner) => runner.run(chat, units.lua, scope, event, host, 'event'))
        : this.bindings.tools.run(chat, units.tool, scope, units.event, host, signal);
      const outcome = await until(running, signal);
      this.journal.report(chat, outcome, from);
      // A showing runs once per stretch shown; kept here, it would push the turns' entries out of the log's bound.
      if ('tool' in units && (event.kind !== 'showing' || outcome.errors.length || outcome.missing.length)) this.journal.keepLog(chat, [{ stage: event.kind, pack: from, script: units.tool.tool.manifest.displayName, at, duration: performance.now() - began, logs: [], writes: outcome.writes, errors: outcome.errors, missing: outcome.missing, stopped: outcome.stop, changed: outcome.value !== undefined, handled: outcome.handled, truncated: false }]);
      return outcome;
    } catch (error) {
      this.journal.report(chat, error, from);
      this.journal.keepLog(chat, [{ stage: event.kind === 'edit' ? event.stage : event.kind, pack: from, script: '', at, duration: performance.now() - began, logs: [], writes: [], errors: [{ from, script: '', message: String(error) }], missing: [], stopped: error instanceof ToolStopped, changed: false, handled: false, truncated: false }]);
      return nothing;
    }
  }
}
