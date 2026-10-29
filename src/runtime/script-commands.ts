import type { Event, ToolEvent } from '../engine/script-api';
import { live } from '../model/library';
import type { ReadModels } from './read-model';
import { onLast } from './script-effects';
import type { ScriptExecution } from './script-execution';
import type { ScriptSchedule } from './script-schedule';
import { atOf, scopeFor, unitFor } from './script-selection';
import type { ObjectStore } from './store';
import type { Tools } from './tools/facade';
import { toolsOf } from './tools/store';

export class ScriptCommands {
  // Presses queued behind an earlier run and not begun, by chat and button.
  private readonly waiting = new Map<string, Promise<boolean>>();

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels },
    private readonly tools: Pick<Tools, 'items' | 'actions'>,
    private readonly schedule: ScriptSchedule,
    private readonly execution: ScriptExecution,
    private readonly closing: AbortSignal,
  ) {}

  // A //@menu item: its writes stay with the last message, whichever version it shows.
  menu(chat: string, module: string, item: string): Promise<void> {
    const unit = unitFor(this.session.store, chat, module);
    if (!unit || !this.tools.items(module).some((each) => each.id === item)) return Promise.resolve();
    return this.schedule.lane(chat, unit, async () => {
      const scope = scopeFor(this.session, chat);
      await this.execution.dispatch(chat, { tool: unit, event: { kind: 'menu', item } }, scope, onLast(scope), this.closing);
    });
  }

  // A //@action item pressed on message: its writes stay with that message, whichever version it shows.
  action(chat: string, module: string, item: string, message: string): Promise<void> {
    const unit = unitFor(this.session.store, chat, module);
    if (!unit || !this.tools.actions(module).some((each) => each.id === item)) return Promise.resolve();
    return this.schedule.lane(chat, unit, async () => {
      const scope = scopeFor(this.session, chat);
      const at = atOf(scope, message);
      if (at) await this.execution.dispatch(chat, { tool: unit, event: { kind: 'action', item, message: at } }, scope, { version: at.version, stays: true }, this.closing);
    });
  }

  // A //@input item pressed in the composer, its writes staying with the last message as a menu item's do. The text it
  // answers, which replaces the draft; null when it answers none or stop, the user's 멈추기, drops the run.
  input(chat: string, module: string, item: string, text: string, stop: AbortSignal): Promise<string | null> {
    const unit = unitFor(this.session.store, chat, module);
    if (!unit?.tool.manifest.inputs?.some((each) => each.id === item)) return Promise.resolve(null);
    let answer: string | null = null;
    return this.schedule.lane(chat, unit, async () => {
      const scope = scopeFor(this.session, chat);
      const { outcome } = await this.execution.dispatch(chat, { tool: unit, event: { kind: 'input', item, text } }, scope, onLast(scope), AbortSignal.any([this.closing, stop]));
      if (typeof outcome.value === 'string' && !stop.aborted) answer = outcome.value;
    }).then(() => answer);
  }

  // Where message stands in the chat now; null once it is gone. For runtime/message-acts, which reads a deleted message
  // before its deletion.
  at(chat: string, message: string): Hazelle.At | null {
    return live(this.session.store.get('chat', chat)) && atOf(scopeFor(this.session, chat), message);
  }

  // The user's own change to a message, once saved (runtime/message-acts). What the tools write answering it is the
  // user's act, not a version's: it stays with the last message, so 다시 생성 does not undo it.
  changed(chat: string, change: Hazelle.Change) {
    this.toTools(chat, { kind: 'change', change });
  }

  // chat: the new branch, once saved, with the ids its copies took.
  branched(chat: string, from: Hazelle.Branched) {
    this.toTools(chat, { kind: 'branch', from });
  }

  private toTools(chat: string, event: Extract<ToolEvent, { kind: 'change' | 'branch' }>) {
    const stored = live(this.session.store.get('chat', chat));
    if (!stored || this.closing.aborted) return;
    for (const unit of toolsOf(this.session.store, stored.value)) {
      void this.schedule.lane(chat, unit, async () => {
        const scope = scopeFor(this.session, chat);
        await this.execution.dispatch(chat, { tool: unit, event }, scope, onLast(scope), this.closing);
      });
    }
  }

  // A press on a bot's button, whose writes stay with the last message whichever version it shows. waits: an earlier
  // run holds the chat (an onOutput's model call can take a minute). The same button pressed again before its waiting
  // press begins joins it: a toggle pressed twice would otherwise land as no change. answered false: no script answered.
  press(chat: string, button: { trigger: string; id: string } | { data: string }): { waits: boolean; answered: Promise<boolean> } {
    const key = `${chat}\n${JSON.stringify(button)}`;
    const joined = this.waiting.get(key);
    if (joined) return { waits: true, answered: joined };
    const event: Event = 'trigger' in button ? { kind: 'call', name: button.trigger, id: button.id } : { kind: 'button', data: button.data };
    const waits = this.schedule.busy(chat);
    const begun = () => { if (this.waiting.get(key) === answered) this.waiting.delete(key); };
    const answered: Promise<boolean> = this.execution.now(chat, event, onLast, begun).then((handled) => handled ?? false).finally(begun);
    if (waits) this.waiting.set(key, answered);
    return { waits, answered };
  }
}
