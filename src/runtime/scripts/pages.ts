import type { ChatScope } from '../../engine/render';
import type { ToolReach } from '../../engine/script-api';
import { live, type PackOwner } from '../../model/library';
import { allWritten } from '../api';
import { cardAssets, editCharacter } from '../library/characters';
import { cardLoreNamed, writeCardLore } from '../library/lore';
import { toolAssetId } from '../tools/store';
import { writePortraits } from '../tasks/likeness';
import { noteStep } from '../diagnostics/auto-diagnosis';
import type { ScriptOutcome } from './lua/event';
import type { ReadModels } from '../store/read-model';
import { onLast, type ScriptEffects } from './effects';
import type { ScriptInteractions } from './interactions';
import type { ScriptReach } from './reach';
import type { ScriptSchedule } from './schedule';
import { scopeFor, unitFor } from './selection';
import type { ObjectStore } from '../store/store';

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

  // A tool's rewrite of the chat's character's card (Hazelle.Chat.editCard), under the character's one answer, which its
  // bot's scripts share (design §6.8).
  async editCard(chat: string, { greeting, lore = [], assets = [], ...edit }: Hazelle.CardEdit, from: PackOwner, signal: AbortSignal): Promise<Hazelle.CardAnswer> {
    const { store } = this.session;
    const character = live(store.get('chat', chat))?.value.character ?? null;
    if (character === null) return { ok: false, reason: 'no-character' };
    for (const { name } of lore) {
      if (lore.filter((entry) => entry.name === name).length > 1 || cardLoreNamed(store, character, name).length > 1) throw new Error(`More than one lore entry is named ${name}`);
    }
    const joining = await Promise.all(assets.map(async ({ name, saved }) => {
      const asset = store.get('asset', await toolAssetId(from.id, saved));
      if (!asset) throw new Error(`This tool saved no asset named ${saved}`);
      return { ...asset.value, name };
    }));
    if (!(await this.interactions.mayRewrite(chat, character, from, false, signal))) return { ok: false, reason: 'not-allowed' };
    const card = live(store.get('character', character))?.value.card;
    if (!card || signal.aborted) return { ok: false, reason: 'failed' };
    const fields = greeting === undefined ? edit : { ...edit, greetings: [greeting, ...card.greetings.slice(1)] };
    const own = cardAssets(store, character);
    const fresh = joining.filter((asset) => !own.some(({ value }) => value.name === asset.name && value.file.id === asset.file.id));
    const saved = await allWritten([
      ...(Object.keys(fields).length ? [editCharacter(store, character, fields)] : []),
      ...lore.map((entry) => writeCardLore(store, character, entry)),
      ...(fresh.length ? [store.batch(fresh.map((value) => ({ type: 'create', kind: 'asset', id: crypto.randomUUID(), parent: character, value })))] : []),
    ]);
    return saved.ok ? { ok: true } : { ok: false, reason: 'failed' };
  }

  // A tool's portraits of the chat's character, or of the 등장인물 it names (Hazelle.Chat.editPortraits), under that
  // character's own card answer: they are the character's, in every chat with it.
  async editPortraits(chat: string, portraits: Hazelle.PortraitEdit[], cast: string | null, from: PackOwner, signal: AbortSignal): Promise<Hazelle.PortraitsAnswer> {
    const { store } = this.session;
    const stored = live(store.get('chat', chat))?.value;
    if (cast !== null && !stored?.cast?.includes(cast)) throw new Error(`This chat has no 등장인물 by the id ${cast}`);
    const character = cast ?? stored?.character ?? null;
    if (character === null) return { ok: false, reason: 'no-character' };
    if (!(await this.interactions.mayRewrite(chat, character, from, false, signal))) return { ok: false, reason: 'not-allowed' };
    if (!live(store.get('character', character)) || signal.aborted) return { ok: false, reason: 'failed' };
    const saved = await writePortraits(store, character, portraits);
    if (saved.ok) return { ok: true, kept: saved.data };
    noteStep(`script-portraits:${saved.error === 'too-many' ? 'too-many' : 'unsaved'}`);
    return { ok: false, reason: saved.error === 'too-many' ? 'too-many' : 'failed' };
  }

  pageWrite(chat: string, module: string, outcome: ScriptOutcome): Promise<void> {
    return this.schedule.queued(chat, async () => {
      const context = this.pageContext(chat, module);
      if (!context) return;
      await this.effects.event(chat, context.scope, outcome, onLast(context.scope), { kind: 'module', id: module });
    });
  }
}
