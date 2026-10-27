import type { Display } from '../engine/display';
import { chatTitle, previewLine, recentIn, shown, type Chat, type ChatItem, type Message, type Summary, type SummaryRead } from '../model/chat';
import { live } from '../model/library';
import type { ApiFailure } from './api';
import type { ObjectStore } from './store';
import type { StoreRead } from './object-index';
import { EvaluationStuck, type Evaluation } from './evaluation';
import { ScopeUnavailable, type ChatLease, type ScopeState } from './chat-scope';
import { pinned, scopeOf } from './chat-context';
import { pause } from './pause';

const VERSION = 1;
export type ChatModel = ChatItem & { display: Display };
// shown tracks the folded overlay, never persisted in Summary: unconfirmed writes must not reach the server through it.
export type Projection = { model: ChatModel; summary: Summary; shown: number };

// Like memoryId, a summary has one id under its chat, independent of which device builds it.
export const summaryId = (chat: string) => chat.replace(/[0-9a-f]/, (digit) => (parseInt(digit, 16) ^ 8).toString(16));

export function summaryStale(store: Pick<ObjectStore, 'get' | 'entryHead' | 'revision'>, id: string, summary: Summary, head = store.entryHead(id)): boolean {
  return summary.version !== VERSION || summary.chatRev !== store.get('chat', id)?.rev || summary.head < head || !readsCurrent(store, summary.dependencies);
}

const readsCurrent = (store: Pick<ObjectStore, 'revision'>, reads: SummaryRead[]) => reads.every((read) => store.revision(read) === read.rev);
const revised = (store: Pick<ObjectStore, 'revision'>, reads: StoreRead[]): SummaryRead[] => [...new Map(reads.map((read) => [JSON.stringify(read), { ...read, rev: store.revision(read) }])).values()];

type Source = Pick<ObjectStore, 'get' | 'children' | 'scopeState' | 'capture' | 'revision' | 'foldedChat' | 'entryHead' | 'loadedHead' | 'shownMark'>;
type Scope = { signal: AbortSignal; state: ScopeState; loading: Promise<ApiFailure | null> | null; error: ApiFailure | null };
type SummaryWrite = { type: 'restore'; id: string; kind: 'summary'; parent: string; value: Summary };
// cleared requests a regex retry; next summary drops the verdict. over fences the summary revision.
// Once either device writes a summary, its verdict is authoritative; never replay a held verdict over it.
type Verdict = { over: number } & ({ state: 'judged'; dependencies: SummaryRead[] } | { state: 'cleared' });
type Lifecycle = {
  closing: AbortSignal;
  scope(chat: string): Scope | undefined;
  held(): Iterable<string>;
  showing(chat: string): boolean;
  refresh(chat: string): Promise<ApiFailure | null>;
  retain(chat: string): ChatLease;
  write(writes: SummaryWrite[], signal?: AbortSignal): Promise<ApiFailure | null>;
  publish(chat: string): void;
  fail(chat: string, signal: AbortSignal, error: unknown): ApiFailure;
  failure(error: unknown): ApiFailure;
  halted(): ApiFailure;
};

// The only owner of computed chat projections and the summaries derived from them. Storage and chat leases stay
// outside: a confirmed write never waits for display, and every job is fenced by its scope signal and the store closing.
export class ChatProjections {
  private readonly projecting = new Map<string, Promise<Projection | null>>();
  private readonly projections = new Map<string, Projection>();
  private readonly summarizing = new Map<string, Promise<ApiFailure | null>>();
  private readonly verdicts = new Map<string, Verdict>();
  private closed = false;

  constructor(private readonly source: Source, private readonly evaluation: Pick<Evaluation, 'display' | 'forget'>, private readonly life: Lifecycle) {}

  release(chat: string) {
    this.projections.delete(chat);
    this.projecting.delete(chat);
    this.summarizing.delete(chat);
    this.verdicts.delete(chat);
    this.evaluation.forget({ asker: 'projection', chat });
  }

  close() {
    this.closed = true;
    for (const chat of new Set([...this.projections.keys(), ...this.projecting.keys(), ...this.summarizing.keys(), ...this.verdicts.keys()])) this.release(chat);
  }

  get(chat: string): Projection | null {
    return !this.closed && this.life.scope(chat)?.state === 'loaded' ? this.projections.get(chat) ?? null : null;
  }

  // EvaluationStuck suppresses display regex and refuses read-only evaluation while its dependencies still match.
  // The summary shares the verdict across devices; 다시 시도 clears it.
  verdict(chat: string): SummaryRead[] | null {
    const held = this.verdicts.get(chat);
    const dependencies = held?.over === this.summaryRev(chat) ? (held.state === 'judged' ? held.dependencies : null) : (this.source.get('summary', summaryId(chat))?.value.stuck?.dependencies ?? null);
    return dependencies && readsCurrent(this.source, dependencies) ? dependencies : null;
  }

  // reads: what a chat not saved yet was displayed from; a saved one is judged on its basis.
  judge(chat: string, reads?: StoreRead[]) {
    const stored = live(this.source.get('chat', chat));
    // The chat's own prompt, persona and cast are handed to its basis as a value, not read: its record stands for them.
    const dependencies = reads ? revised(this.source, reads) : stored && [...this.basis(chat, stored.value, []).dependencies, ...revised(this.source, [{ kind: 'chat', id: chat }])];
    if (!dependencies) return;
    this.verdicts.set(chat, { state: 'judged', dependencies, over: this.summaryRev(chat) });
    this.changedVerdict(chat);
  }

  clear(chat: string) {
    this.verdicts.set(chat, { state: 'cleared', over: this.summaryRev(chat) });
    this.changedVerdict(chat);
  }

  private summaryRev(chat: string) {
    return this.source.revision({ kind: 'summary', id: summaryId(chat) });
  }

  private changedVerdict(chat: string) {
    this.life.publish(chat);
    if (this.life.scope(chat)?.state === 'loaded') this.summarizeChat(chat);
  }

  async evaluate(chat: string): Promise<Projection | null> {
    const pending = this.projecting.get(chat);
    if (pending) { await pending; return this.evaluate(chat); }
    const loading = this.life.scope(chat)?.loading;
    if (loading) { if (await loading) return null; return this.evaluate(chat); }
    if (this.closed || this.life.scope(chat)?.state !== 'loaded') return null;
    const previous = this.projections.get(chat);
    if (previous && previous.shown === this.source.shownMark(chat) && !summaryStale(this.source, chat, previous.summary, this.source.loadedHead(chat)) && (previous.summary.stuck !== undefined) === (this.verdict(chat) !== null)) return previous;
    const scope = this.life.scope(chat)!;
    const work = (async () => {
      for (;;) {
        const next = await this.project(chat, AbortSignal.any([scope.signal, this.life.closing])).catch((error: unknown) => {
          this.life.fail(chat, scope.signal, error);
          throw error;
        });
        if (this.closed || this.life.scope(chat)?.signal !== scope.signal || this.life.scope(chat)?.state !== 'loaded' || this.life.closing.aborted) return null;
        if (this.life.scope(chat)?.loading) return this.projections.get(chat) ?? null;
        if (next && (next.shown !== this.source.shownMark(chat) || summaryStale(this.source, chat, next.summary, this.source.loadedHead(chat)))) continue;
        if (next) this.projections.set(chat, next);
        else this.projections.delete(chat);
        this.life.publish(chat);
        return next;
      }
    })();
    this.projecting.set(chat, work);
    let result: Projection | null;
    try { result = await work; }
    finally { if (this.projecting.get(chat) === work) this.projecting.delete(chat); }
    return this.life.scope(chat)?.loading ? this.evaluate(chat) : result;
  }

  // Writes finish at server acceptance, not display completion. Readers needing the new projection await evaluate(chat);
  // projection failure belongs to the chat scope, never retroactively to the write.
  refreshHeld() {
    for (const chat of this.life.held()) {
      const scope = this.life.scope(chat);
      if (scope?.state === 'loaded' && !scope.loading) void this.evaluate(chat).catch((error: unknown) => void this.life.failure(error));
    }
  }

  async save(chat: string): Promise<ApiFailure | null> {
    const pending = this.summarizing.get(chat);
    if (pending) return pending;
    const save = async (): Promise<ApiFailure | null> => {
      for (;;) {
        // The scope's own controller, ended when its last lease is let go or the store ends: no
        // retry of a summary write outlives the chat being held.
        const scope = this.life.scope(chat);
        if (!scope || scope.signal.aborted) return this.life.halted();
        if (this.source.loadedHead(chat) < this.source.entryHead(chat)) {
          const failed = await this.life.refresh(chat);
          if (failed) return failed;
        }
        const write = await this.summaryWrite(chat);
        if (this.closed || this.life.scope(chat)?.signal !== scope.signal) return this.life.halted();
        if (!write) return null;
        const result = await this.life.write([write], scope.signal);
        if (result) return result;
      }
    };
    const saving = save().catch((error: unknown) => this.life.failure(error)).finally(() => { if (this.summarizing.get(chat) === saving) this.summarizing.delete(chat); });
    this.summarizing.set(chat, saving);
    return saving;
  }

  // Caller must hold/load chats so summaries use in-memory source and save together.
  // Repeat until every chat is current; changes during the pass cannot retain earlier captures.
  // Return opening/evaluation failures; never-held chats are caller errors.
  async saveMany(chats: Iterable<string>, signal?: AbortSignal): Promise<ApiFailure | null> {
    let passes = 0;
    try {
      for (;;) {
        const writes: SummaryWrite[] = [];
        for (const chat of chats) {
          const scope = this.life.scope(chat);
          if (!scope || scope.signal.aborted) {
            // Let go by the caller's stop or after a pass (withChats): halted. Never held: the caller's error.
            if (passes || signal?.aborted || this.life.closing.aborted) return this.life.halted();
            throw new ScopeUnavailable(chat);
          }
          // A chat whose history cannot be read is passed over, as withChats passes over one that cannot open: its
          // screen says so.
          const failure = scope.state !== 'loaded' ? scope.error ?? this.life.halted() : this.source.loadedHead(chat) < this.source.entryHead(chat) ? await this.life.refresh(chat) : null;
          if (failure?.error === 'unreadable') continue;
          if (failure) return failure;
          const write = await this.summaryWrite(chat);
          if (this.closed || this.life.scope(chat)?.signal !== scope.signal) return this.life.halted();
          if (write) writes.push(write);
        }
        if (!writes.length) return null;
        const result = await this.life.write(writes, signal);
        if (result) return result;
        passes++;
      }
    } catch (error) {
      return this.life.failure(error);
    }
  }

  private async summaryWrite(chat: string): Promise<SummaryWrite | null> {
    const projection = await this.evaluate(chat);
    // Neither a chat still showing an overlay nor a projection folded while it did: the commit that ends the chat's last
    // overlay summarizes it again (summarizeHeld).
    if (!projection || this.life.showing(chat) || projection.shown !== this.source.shownMark(chat)) return null;
    const id = summaryId(chat);
    const current = this.source.get('summary', id);
    if (current && !summaryStale(this.source, chat, current.value) && current.value.title === projection.summary.title && current.value.preview === projection.summary.preview && JSON.stringify(current.value.stuck) === JSON.stringify(projection.summary.stuck)) return null;
    // The projection's source versions travel with it. A concurrent edit can never make an old summary look current.
    return { type: 'restore', id, kind: 'summary', parent: chat, value: projection.summary };
  }

  // Summaries follow a write unawaited: one that fails stays stale, and the chat's next opening (retainChat) writes it
  // again. Only held chats are summarized; any write can change what they display.
  summarizeHeld() {
    for (const chat of this.life.held()) {
      if (this.life.scope(chat)?.state !== 'loaded') continue;
      this.summarizeChat(chat);
    }
  }

  summarizeChat(chat: string) {
    const lease = this.life.retain(chat);
    void lease.ready.then((failure) => failure ?? this.save(chat)).finally(lease.release);
  }

  private async project(id: string, signal?: AbortSignal): Promise<Projection | null> {
    const store = this.source;
    const stored = live(store.get('chat', id));
    if (!stored) return null;
    const { messages, at } = store.foldedChat(id);
    const head = store.loadedHead(id);
    const marks = store.shownMark(id);
    const rendered = { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const { scope, take, dependencies } = this.basis(id, stored.value, messages);
    const lane = { asker: 'projection', chat: id } as const;
    // A run that stuck with the bot's regex judged the chat, so it is run once more without; one that stuck without it
    // fails the chat.
    let display: Display;
    try { ({ display } = await this.evaluation.display(lane, { ...scope, clock: rendered }, take, signal)); }
    catch (error) {
      if (!(error instanceof EvaluationStuck && error.regex)) throw error;
      ({ display } = await this.evaluation.display(lane, { ...scope, clock: rendered }, take, signal));
    }
    const verdict = this.verdict(id);
    // A message is named as the reader reads it: its translation when it has one.
    const texts = display.texts.map((text, index) => shown(messages[index]!).translation?.text ?? text);
    const last = messages.at(-1);
    const summary: Summary = {
      version: VERSION, head, chatRev: stored.rev, rendered,
      dependencies,
      ...(verdict && { stuck: { dependencies: verdict } }),
      character: stored.value.character, count: messages.length,
      title: chatTitle(stored.value, messages, texts).slice(0, 256),
      preview: last === undefined ? '' : previewLine(texts.at(-1)!, shown(last).translation?.text ?? shown(last).text).slice(0, 256),
      at, order: head || stored.rev, recent: recentIn(messages),
    };
    return { summary, model: { ...summary, id, chat: stored.value, messages, display }, shown: marks };
  }

  // What a chat's display stands on besides its messages, with the reads it was taken from.
  private basis(id: string, chat: Chat, messages: Message[]) {
    const store = this.source;
    const { value, reads } = store.capture(() => ({ scope: scopeOf({ store }, id, chat, messages), take: pinned({ store }, chat) }));
    return { ...value, dependencies: revised(store, reads) };
  }
}

// Bound account-wide passes to SUMMARY_WINDOW histories and one write request per window.
// Skip existing summaries (opening refreshes stale ones), unreadable/stuck chats; interrupted restores resume missing windows.
export const SUMMARY_WINDOW = 16;
export async function saveSummaries(store: ObjectStore, chats: Iterable<string>, signal = new AbortController().signal, progress: (done: number, total: number) => void = () => {}): Promise<ApiFailure | null> {
  const due = [...chats].filter((id) => !store.get('summary', summaryId(id)));
  progress(0, due.length);
  for (let start = 0; start < due.length; start += SUMMARY_WINDOW) {
    if (signal.aborted) return { ok: false, error: 'stopped' };
    const result = await store.withChats(due.slice(start, start + SUMMARY_WINDOW), async (readable) => await store.projections.saveMany(readable, signal) ?? { ok: true, data: null }, { signal, summarize: false });
    if (!result.ok) return result;
    progress(Math.min(start + SUMMARY_WINDOW, due.length), due.length);
    if (!await pause(0, signal)) return { ok: false, error: 'stopped' };
  }
  return null;
}

// A chat lacks its summary when the write that follows its messages failed (ObjectStore.writeOne). Opening it writes one
// too, so this catches the chats nobody opens.
export const backfillSummaries = (store: ObjectStore, signal: AbortSignal) => saveSummaries(store, store.list('chat').filter(live).map(({ id }) => id), signal);
