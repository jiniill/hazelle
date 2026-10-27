import { ChangeSignal } from '../change-signal';
import type { Role } from '../connectors/assignment';
import { Runaway } from '../engine/cbs/evaluate';
import type { Outcome, Question } from '../engine/script-api';
import { live, type PackOwner } from '../model/library';
import { toolId } from '../model/tool';
import type { ApiFailure, ApiResult } from './api';
import { EvaluationStuck } from './evaluation';
import { LuaStuck } from './lua/client';
import { setCardWrites } from './characters';
import { GRANTS, setGrants, setModels, type Grant } from './pack';
import { ToolLate, ToolStopped, ToolStuck, until } from './script-binding';
import type { ObjectStore } from './store';
import { toolsOf, ToolRate, TOOL_NOTICES_PER_MINUTE } from './tools/store';

// said is script-authored text; other variants are app notices. late/stuck/held describe tool gates.
// answer-unsaved must ask consent again. input-stop is told once per chat so a deliberately absent reply
// is not mistaken for a broken bot (design §6.8).
type Note =
  | { kind: 'said'; tone: 'normal' | 'error'; text: string }
  | { kind: 'failed'; message: string }
  | { kind: 'missing'; names: string[] }
  | { kind: 'stuck'; disabled?: true }
  | { kind: 'no-model'; role: Role }
  | { kind: 'late' }
  | { kind: 'memory-held'; by: string }
  | { kind: 'stale-reply' }
  | { kind: 'flood' }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'answer-unsaved'; failure: ApiFailure }
  | { kind: 'runaway' }
  | { kind: 'input-stop' };
export type ScriptNote = { id: number; chat: string; from: PackOwner | null } & Note;
// Save model consent on its spender, card-write consent on the character, plugin uses on the module.
// Dismissal saves nothing. Plugin cards combine unanswered uses; hosts are Risu literal hosts, empty for Hazelle tools.
export type ScriptQuestion = { id: number; chat: string; from: PackOwner; question: Question | { kind: 'model' } | { kind: 'card' } | { kind: 'plugin'; grants: Grant[]; hosts: string[] } };
export type ScriptsState = { notes: ScriptNote[]; questions: ScriptQuestion[] };

export class ScriptInteractions {
  private state: ScriptsState = { notes: [], questions: [] };
  private readonly changes = new ChangeSignal();
  private readonly answers = new Map<number, (answer: string | null) => void>();
  // What each chat was already told of its bot's errors, so a script failing on every message says so once.
  private readonly told = new Map<string, Set<string>>();
  private ids = 0;
  // waiting: the chats whose runs wait on it.
  private readonly consents = new Map<string, { question: number; deciding: Promise<boolean>; waiting: Set<string> }>();
  // The chat on screen, as claims last named it.
  private shown: string | null = null;
  private readonly notices = new ToolRate(TOOL_NOTICES_PER_MINUTE);

  constructor(private readonly store: ObjectStore, private readonly closing: AbortSignal) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  seen(note: number) {
    this.set({ ...this.state, notes: this.state.notes.filter(({ id }) => id !== note) });
  }

  // null: dismissed, which answers nothing.
  answer(question: number, answer: string | null) {
    this.answers.get(question)?.(answer);
  }

  close() {
    for (const { id } of this.state.questions) this.answer(id, null);
  }

  report(chat: string, result: Pick<Outcome, 'errors' | 'missing'> | unknown, from: PackOwner | null = null) {
    if (result instanceof ToolStopped) return;
    if (result instanceof ToolLate) return this.tell(chat, 'late', { kind: 'late' }, from);
    if (result instanceof ToolStuck) return result.disabled ? this.tell(chat, 'disabled', { kind: 'stuck', disabled: true }, from) : this.note(chat, { kind: 'stuck' }, from);
    if (result instanceof LuaStuck || result instanceof EvaluationStuck) return this.note(chat, { kind: 'stuck' }, from);
    if (result instanceof Runaway) return this.tell(chat, 'runaway', { kind: 'runaway' }, from);
    if (result instanceof Error) return this.tell(chat, `failed:${result.message}`, { kind: 'failed', message: result.message }, from);
    const { errors, missing } = result as Pick<Outcome, 'errors' | 'missing'>;
    for (const error of errors) {
      if ('runaway' in error) this.tell(chat, 'runaway', { kind: 'runaway' }, error.from);
      else this.tell(chat, `failed:${error.message}`, { kind: 'failed', message: `${error.script}: ${error.message}` }, error.from);
    }
    if (missing.length > 0) this.tell(chat, `missing:${missing.join()}`, { kind: 'missing', names: missing }, from);
  }

  ask(chat: string, question: ScriptQuestion['question'], from: PackOwner, signal?: AbortSignal): Promise<string | null> {
    return this.asked(++this.ids, chat, question, from, signal);
  }

  private asked(id: number, chat: string, question: ScriptQuestion['question'], from: PackOwner, signal?: AbortSignal): Promise<string | null> {
    if (this.closing.aborted || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const abort = () => this.answer(id, null);
      signal?.addEventListener('abort', abort, { once: true });
      this.answers.set(id, (answer) => {
        signal?.removeEventListener('abort', abort);
        this.answers.delete(id);
        this.set({ ...this.state, questions: this.state.questions.filter((each) => each.id !== id) });
        resolve(answer);
      });
      this.set({ ...this.state, questions: [...this.state.questions, { id, chat, question, from }] });
    });
  }

  // Whether spender may call models, embeddings included (design §6.8, §6.10): asked once per spender and kept on it.
  // Under a deadline an unanswered one is no, without a card; the next run with time to wait asks.
  async allowed(chat: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this;
    const spender = live(store.get(from.kind, from.id))!;
    if (spender.value.botModels !== undefined) return spender.value.botModels;
    if (deadline) return false;
    if (from.kind === 'module' && this.unanswered(from.id).includes('model')) return this.grant(chat, from.id, 'model', signal);
    return this.decide(`${from.kind}:${from.id}`, chat, { kind: 'model' }, from, (yes) => setModels(store, from, yes), signal);
  }

  // Whether a script may rewrite character's card: asked once per character and kept on it, as allowed is.
  async mayRewrite(chat: string, character: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this;
    const stored = live(store.get('character', character));
    if (!stored) return false;
    if (stored.value.cardWrites !== undefined) return stored.value.cardWrites;
    if (deadline) return false;
    return this.decide(`card:${character}`, chat, { kind: 'card' }, from, (yes) => setCardWrites(store, character, yes), signal);
  }

  // Whether module's tool may reach the outside (design §6.10), under its plugin card.
  async mayFetch(chat: string, module: string, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const stored = live(this.store.get('module', module));
    if (!stored) return false;
    if (stored.value.network !== undefined) return stored.value.network;
    if (deadline) return false;
    return this.grant(chat, module, 'network', signal);
  }

  // The chat opened: it takes the cards its runs wait on, and its tools' plugin cards are asked (design §6.10), not first
  // when a tool uses one.
  claims(chat: string) {
    this.shown = chat;
    for (const { question, waiting } of this.consents.values()) if (waiting.has(chat)) this.move(question, chat);
    const stored = live(this.store.get('chat', chat));
    if (!stored || this.closing.aborted) return;
    for (const { module } of toolsOf(this.store, stored.value)) if (this.unanswered(module).length > 0) void this.card(chat, module);
  }

  // What module's tool declares and its module has not answered.
  private unanswered(module: string): Grant[] {
    const uses = this.store.get('tool', toolId(module))?.value.manifest.uses ?? [];
    const value = this.store.get('module', module)?.value;
    if (!value) return [];
    return [
      ...(uses.includes('network') && value.network === undefined ? ['network' as const] : []),
      ...(uses.some((use) => use === 'model' || use === 'embed') && value.botModels === undefined ? ['model' as const] : []),
      ...(uses.includes('memory') && value.takesMemory === undefined ? ['memory' as const] : []),
    ];
  }

  // One shared plugin/account card (user, 2026-10-21), never owned by one waiter.
  // Cancellation detaches only that waiter. Re-read its use afterward: reimport may have added uses absent from the card.
  private async grant(chat: string, module: string, use: Grant, signal?: AbortSignal): Promise<boolean> {
    const answered = await until(this.card(chat, module), signal).then(() => true, () => false);
    return answered && this.store.get('module', module)?.value[GRANTS[use]] === true;
  }

  private card(chat: string, module: string): Promise<boolean> {
    const grants = this.unanswered(module);
    const hosts = this.store.get('tool', toolId(module))?.value.manifest.risu?.hosts ?? [];
    return this.decide(`plugin:${module}`, chat, { kind: 'plugin', grants, hosts }, { kind: 'module', id: module }, (yes) => setGrants(this.store, module, grants, yes));
  }

  // One question per key; dismissal saves nothing and means no.
  // Joining foreground chats take the card; background joiners must not move it.
  private decide(key: string, chat: string, question: ScriptQuestion['question'], from: PackOwner, save: (yes: boolean) => Promise<ApiResult<unknown>>, signal?: AbortSignal): Promise<boolean> {
    const asked = this.consents.get(key);
    if (asked) {
      asked.waiting.add(chat);
      if (chat === this.shown) this.move(asked.question, chat);
      return asked.deciding;
    }
    const id = ++this.ids;
    const deciding = this.asked(id, chat, question, from, signal).then(async (answer) => {
      if (answer === null) return false;
      const saved = await save(answer === 'yes');
      if (!saved.ok) this.note(chat, { kind: 'answer-unsaved', failure: saved }, from);
      return saved.ok && answer === 'yes';
    }).finally(() => this.consents.delete(key));
    this.consents.set(key, { question: id, deciding, waiting: new Set([chat]) });
    return deciding;
  }

  private move(question: number, chat: string) {
    if (this.state.questions.some((each) => each.id === question && each.chat !== chat)) {
      this.set({ ...this.state, questions: this.state.questions.map((each) => (each.id === question ? { ...each, chat } : each)) });
    }
  }

  // A claim holds up no run, so it stays until the user answers it; a fetch that joined a network claim waits with it,
  // holding only its own tool's lane.
  dismiss(chat: string) {
    for (const { id, chat: asked, question } of this.state.questions) if (asked === chat && question.kind !== 'plugin') this.answer(id, null);
  }

  tell(chat: string, key: string, note: Note, from: PackOwner | null = null) {
    key = `${from?.kind}:${from?.id}:${key}`;
    const told = this.told.get(chat) ?? new Set();
    this.told.set(chat, told);
    if (told.has(key)) return;
    told.add(key);
    this.note(chat, note, from);
  }

  note(chat: string, note: Note, from: PackOwner | null = null) {
    if ((note.kind === 'said' || note.kind === 'failed') && from?.kind === 'module' && this.store.get('tool', toolId(from.id)) && !this.notices.take(`${chat}:${from.id}`)) return;
    this.set({ ...this.state, notes: [...this.state.notes, { id: ++this.ids, chat, from, ...note }] });
  }

  private set(state: ScriptsState) {
    this.state = state;
    this.changes.notify();
  }
}
