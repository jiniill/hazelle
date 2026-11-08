import type { ChatScope } from '../../engine/render';
import type { ToolReach } from '../../engine/script-api';
import type { PackOwner } from '../../model/library';
import type { ScriptOutcome } from './lua/event';
import type { ReadModels } from '../read-model';
import { onLast, type ScriptEffects } from './effects';
import type { ScriptInteractions } from './interactions';
import type { ScriptReach } from './reach';
import type { ScriptSchedule } from './schedule';
import { scopeFor, unitFor } from './selection';
import type { ObjectStore } from '../store';

// send: the screen's own send, null once sent or why not. rendered: a message version as the screen's display gives it
// now (at null: the greeting).
export type ScreenAt = { id: string; version: string } | null;
export type ChatScreen = { send(text: string): Promise<'busy' | 'failed' | null>; rendered(at: ScreenAt): Hazelle.Rendered | null };

export class ScriptPages {
  // The open chat screens, by chat (useChat).
  private readonly screens = new Map<string, ChatScreen>();

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels },
    private readonly interactions: ScriptInteractions,
    private readonly schedule: ScriptSchedule,
    private readonly reach: ScriptReach,
    private readonly effects: ScriptEffects,
    private readonly closing: AbortSignal,
  ) {}

  pageContext(chat: string, module: string, signal?: AbortSignal): { scope: ChatScope; host: ToolReach } | null {
    if (this.closing.aborted || !unitFor(this.session.store, chat, module)) return null;
    const scope = scopeFor(this.session, chat);
    return { scope, host: this.reach.host(chat, scope, signal) };
  }

  screen(chat: string, screen: ChatScreen): () => void {
    this.screens.set(chat, screen);
    return () => { if (this.screens.get(chat) === screen) this.screens.delete(chat); };
  }

  rendered(chat: string, at: ScreenAt): Hazelle.Rendered | null {
    return this.screens.get(chat)?.rendered(at) ?? null;
  }

  // A tool's message as the user's (Hazelle.Chat.send): through the screen's send, never a turn of its own, so
  // translation, the bot's scripts, tools and memory run as when it is typed (as 오토파일럿's do).
  async send(chat: string, text: string, from: PackOwner, signal: AbortSignal): Promise<Hazelle.SendAnswer> {
    if (!this.screens.has(chat)) return { ok: false, reason: 'closed' };
    if (!(await this.interactions.allowed(chat, from, false, signal))) return { ok: false, reason: 'not-allowed' };
    const screen = this.screens.get(chat);
    if (!screen || signal.aborted) return { ok: false, reason: 'closed' };
    const refused = await screen.send(text);
    return refused ? { ok: false, reason: refused } : { ok: true };
  }

  pageWrite(chat: string, module: string, outcome: ScriptOutcome): Promise<void> {
    return this.schedule.queued(chat, async () => {
      const context = this.pageContext(chat, module);
      if (!context) return;
      await this.effects.event(chat, context.scope, outcome, onLast(context.scope), { kind: 'module', id: module });
    });
  }
}
