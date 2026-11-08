import type { ChatScope } from '../../engine/render';
import type { Outcome } from '../../engine/script-api';
import { shown } from '../../model/chat';
import type { PackOwner } from '../../model/library';
import { allWritten } from '../api';
import { appendScripted } from '../chat-log';
import { upsertChatLore } from '../lore';
import type { ScriptOutcome } from './lua/event';
import type { ReadModels } from '../read-model';
import type { ScriptInteractions } from './interactions';
import type { ObjectStore } from '../store';
import { saveToolChat } from '../tools/store';

export type Anchor = { version: string; stays?: true };

export const onLast = (scope: ChatScope): Anchor | null => {
  const last = scope.messages.at(-1)?.id;
  return last ? { version: last, stays: true } : null;
};

// The only place that turns what a run did into entries.
export class ScriptEffects {
  private readonly reloads = new Set<(chat: string) => void>();

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels },
    private readonly interactions: ScriptInteractions,
  ) {}

  subscribeReload(listener: (chat: string) => void): () => void {
    this.reloads.add(listener);
    return () => { this.reloads.delete(listener); };
  }

  // anchor: where its writes stand; null leaves them to the caller.
  async event(chat: string, scope: ChatScope, outcome: ScriptOutcome, anchor: Anchor | null, from: PackOwner | null, reply?: string): Promise<{ outcome: Outcome; changed: boolean }> {
    const greeting = scope.greeting === null ? 0 : 1;
    const current = this.session.read.chat(chat).snapshot()?.messages ?? [];
    const messages = new Map(current.map((message) => [shown(message).id, message]));
    const latest = current.at(-1);
    const stale = reply !== undefined && (!latest || shown(latest).id !== reply);
    // A reply handler may always keep state/storage and edit its own shown reply. Adds and other edits
    // land only while that reply is still the latest shown version; a delayed job cannot rewrite a newer story.
    if (stale && (outcome.added.length || outcome.edits.some(({ index }) => scope.messages[index + greeting]?.id !== reply))) this.interactions.tell(chat, 'stale-reply', { kind: 'stale-reply' }, from);
    const at = (index: number) => messages.get(scope.messages[index + greeting]?.id ?? '');
    const edits = outcome.edits.flatMap(({ index, text, wrote }) => {
      const message = at(index);
      return message && (!stale || shown(message).id === reply) ? [{ message, wrote, text }] : [];
    });
    const removed = outcome.removed.flatMap((index) => at(index)?.id ?? []);
    const adding = (stale ? [] : outcome.added).map(({ role, text, before }) => ({ role: role === 'user' ? ('user' as const) : ('assistant' as const), text, before }));
    // Each run of adds ahead of one message (or after the last) continues the message before that place.
    const runs = new Map<number | null, typeof adding>();
    for (const item of adding) runs.set(item.before, [...(runs.get(item.before) ?? []), item]);
    const added = [...runs].flatMap(([before, items]) => {
      const ahead = before === null ? null : (at(before) ?? null);
      if (before !== null && !ahead) return [];
      const previous = ahead ? current[current.indexOf(ahead) - 1] : latest;
      return [{ follows: previous ? shown(previous).id : null, ahead, messages: items.map(({ role, text }) => ({ role, text })) }];
    });
    const saved = await appendScripted(this.session.store, chat, { edits, removed, added, vars: anchor && { ...anchor, set: outcome.writes } });
    if (!saved.ok) this.interactions.note(chat, { kind: 'unsaved', failure: saved }, from);
    // State, as variables are, so a stale reply's lands too.
    const lore = await allWritten(outcome.lore.map((entry) => upsertChatLore(this.session.store, chat, entry)));
    if (!lore.ok) this.interactions.note(chat, { kind: 'unsaved', failure: lore }, from);
    if (outcome.tool && from?.kind === 'module' && (outcome.tool.data.length || outcome.tool.badges.length)) {
      // A badge stands on the version shown when it lands. A delayed reply job's badges, as its edits, mark only its reply.
      const badges = outcome.tool.badges.flatMap(({ index, text }) => {
        const message = at(index);
        return message && (!stale || shown(message).id === reply) ? [{ message: message.id, version: shown(message).id, text }] : [];
      });
      const kept = await saveToolChat(this.session.store, from.id, chat, outcome.tool.data, badges);
      if (!kept.ok) this.interactions.note(chat, { kind: 'unsaved', failure: kept }, from);
    }
    if (outcome.reload) for (const reload of this.reloads) reload(chat);
    return { outcome, changed: edits.length + removed.length + adding.length + outcome.lore.length > 0 };
  }
}
