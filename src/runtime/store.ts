import { ChatFold } from '../model/chat';
import type { AppendOnly, Kind, Singleton, Stored, Values } from '../model/kinds';
import { objectKey } from '../vault/objects';
import type { VaultKey } from '../vault/keys';
import type { FeedAnswer, SealedChange } from '../contracts/objects';
import type { ApiFailure, ApiResult } from './api';
import { feedQuery, type Backend } from './backend';
import { ConnectionWait } from './connection-wait';
import { StoreChanges } from './store-changes';
import { CodecAborted, CodecUnavailable, ObjectCodec } from './object-codec';
import { SCOPED, UNFED, WALKED, type CacheState, type DeviceCache } from './object-cache';
import { ObjectCacheSession } from './object-cache-session';
import { Evaluation, EvaluationFailed, EvaluationStopped, EvaluationStuck } from './evaluation';
import { ChatProjections } from './summary';
import { ScopeUnavailable, type ChatLease, type ScopeState } from './chat-scope';
import { ObjectIndex, type Held, type StoreChange, type StoreRead } from './object-index';
import { ObjectWrites, type Limits, type Pending, type Resolved, type Write, type WriteStep } from './object-writes';
import { PendingWrites, chatOf, type Overlay, type PendingCommit } from './pending-writes';
import { upgradeValue } from './upgrade';

export type ObjectRow = { id: string; kind: string; parent: string | null; rev: number };
// total: what the whole bootstrap holds, once its first page said; an incremental pull has none.
export type PullProgress = { objects: number; pages: number; waiting: boolean; total?: number };
type PullOptions = { signal?: AbortSignal; progress?: (progress: PullProgress) => void };

export type Pin = { timeline: string };
const MAX_ATTEMPTS = 3;
type Scope = { fold: ChatFold; opening: Promise<ApiFailure | null> | null; abort: AbortController; state: ScopeState; users: number; cursor: number; head: number; loading: Promise<ApiFailure | null> | null; error: ApiFailure | null; summarize: boolean };
// The backend owns confirmed state; conflicts pull the latest copy and reapply the change.
// A store belongs to one timeline: rewind ends it, and the next store inherits no state or work.
export class ObjectStore {
  private readonly closing = new AbortController();
  private readonly objects = new ObjectIndex();
  private readonly pending = new PendingWrites(this.objects);
  private readonly upgraded = new Map<string, string>();
  private readonly changes = new StoreChanges();
  private readonly connection = new ConnectionWait();
  private cursor = 0;
  private bootstrap: number | null = null;
  private bootstrapped = false;
  private readonly scopes = new Map<string, Scope>();
  readonly evaluation = new Evaluation({ verdict: (chat) => this.changes.unrecorded(() => this.projections.verdict(chat) !== null), judged: (chat) => this.projections.judge(chat) });
  readonly projections: ChatProjections;
  private readonly behind = new Set<string>();
  private limits: Limits | null = null;
  private pulling: Promise<ApiFailure | null> | null = null;
  // The server's token for the account's history (server/account-store), replaced by every restore there. Sent with
  // every feed and batch, and adopted only from the answer to a bootstrap sent with none.
  private timeline: string | null = null;
  // Once the store ended for a restore: how many of the person's writes it dropped.
  private rewound: number | null = null;
  private readonly rewoundListeners = new Set<(dropped: number) => void>();
  private known = 0;
  private restored = false;
  private openingFailure: ApiFailure | null = null;
  private readonly cachedObjects: ObjectCacheSession;
  private readonly codec: ObjectCodec;
  private readonly writes: ObjectWrites;

  private constructor(
    accountId: string,
    key: CryptoKey,
    private readonly backend: Backend,
    cache?: DeviceCache,
  ) {
    this.cachedObjects = new ObjectCacheSession(cache, this.closing.signal, () => this.rewind(false));
    this.codec = new ObjectCodec(accountId, key);
    this.writes = new ObjectWrites(this.objects, this.codec);
    this.projections = new ChatProjections({
      get: (kind, id) => this.get(kind, id),
      children: (kind, parent) => this.children(kind, parent),
      scopeState: (chat) => this.scopeState(chat),
      capture: (read) => this.capture(read),
      revision: (read) => this.revision(read),
      foldedChat: (chat) => this.foldedChat(chat),
      entryHead: (chat) => this.entryHead(chat),
      loadedHead: (chat) => this.loadedHead(chat),
      shownMark: (chat) => this.shownMark(chat),
    }, this.evaluation, {
      closing: this.closing.signal,
      scope: (chat) => {
        const scope = this.scopes.get(chat);
        return scope && { signal: scope.abort.signal, state: scope.state, loading: scope.loading, error: scope.error };
      },
      held: () => this.scopes.keys(),
      showing: (chat) => this.pending.showing(chat),
      refresh: (chat) => this.refreshChat(chat),
      retain: (chat) => this.retainChat(chat),
      write: async (writes, signal) => {
        const result = await this.commit(writes.map((write) => this.writes.step(write)), undefined, signal);
        return result.ok ? null : result;
      },
      publish: (chat) => {
        this.changes.add({ kind: 'projection', id: chat, parent: chat });
        this.changes.publish();
      },
      fail: (chat, signal, error) => {
        const scope = this.scopes.get(chat);
        return scope?.abort.signal === signal ? this.failScope(chat, scope, error) : this.codecFailure(error);
      },
      failure: (error) => this.codecFailure(error),
      halted: () => this.halted(),
    });
  }

  static async open(accountId: string, vaultKey: VaultKey, backend: Backend, cache?: DeviceCache, signal?: AbortSignal): Promise<ObjectStore> {
    const key = await objectKey(vaultKey);
    const store = new ObjectStore(accountId, key, backend, cache);
    if (await store.load(signal)) return store;
    // A device copy that does not open is not read again this session, and the rows read before it failed go with it.
    store.close();
    return new ObjectStore(accountId, key, backend);
  }

  // Answers false for a device copy that could not be read.
  private async load(signal?: AbortSignal): Promise<boolean> {
    if (!this.cachedObjects.available) return true;
    const stop = AbortSignal.any([this.closing.signal, ...(signal ? [signal] : [])]);
    try {
      const openedCache = await this.cachedObjects.open();
      if (!openedCache) return true;
      const { generation, saved } = openedCache;
      this.timeline = generation.timeline;
      if (!saved) return true;
      const { state } = saved;
      this.cursor = state.cursor;
      this.bootstrap = state.until;
      this.bootstrapped = state.complete;
      this.limits = state.limits;
      this.objects.loadRevisions(state);
      this.known = Math.max(state.cursor, state.until ?? 0);
      for (const [, rev] of [...state.heads, ...state.revisions]) this.known = Math.max(this.known, rev);
      const rows = saved.changes.sort((a, b) => a.rev - b.rev);
      const opened = this.opener(rows, false, stop);
      for (const [index, row] of rows.entries()) {
        if (stop.aborted) return true;
        await this.apply(row, () => opened(index), false, stop);
      }
      this.changes.publish();
      this.restored = true;
      return true;
    } catch (error) {
      // Cancellation and a failed worker say nothing about the validity of the encrypted device copy.
      if (error instanceof CodecAborted) return true;
      if (error instanceof CodecUnavailable) {
        this.openingFailure = this.codecFailure(error);
        return true;
      }
      return false;
    }
  }

  get cached(): boolean { return this.restored; }

  private cacheState(scope?: { cursor: number; complete: boolean }): CacheState {
    return {
      cursor: scope?.cursor ?? this.cursor,
      complete: scope ? scope.complete : this.bootstrapped,
      until: scope ? null : this.bootstrap,
      limits: this.limits,
      ...(scope ? { heads: [], revisions: [] } : this.objects.snapshotRevisions()),
    };
  }

  // scope: the parent whose rows were read up to cursor (a chat's, or a walked kind's).
  private cacheWrite(changes: SealedChange[], scope?: { chat: string; cursor: number; complete: boolean }) {
    if (!this.cachedObjects.available || this.timeline === null) return;
    const scopes = scope ? [{ chat: scope.chat, state: this.cacheState(scope) }] : [...new Set(changes.filter((row) => SCOPED.has(row.kind)).map((row) => row.parent!))].flatMap((chat) => {
      const held = this.scopes.get(chat);
      return held?.state === 'loaded' && !held.loading ? [{ chat, state: this.cacheState({ cursor: held.cursor, complete: true }) }] : [];
    });
    this.cachedObjects.write({ changes, feed: this.cacheState(), scopes });
  }

  // Report dropped writes once on rewind; late subscribers receive the result immediately.
  readonly subscribeRewound = (listener: (dropped: number) => void) => {
    if (this.rewound !== null) {
      listener(this.rewound);
      return () => {};
    }
    this.rewoundListeners.add(listener);
    return () => { this.rewoundListeners.delete(listener); };
  };

  // A refused timeline or another tab's cache generation ends this store; count and drop unsent writes, never replay them.
  // clear also invalidates the device copy. Workspace opens the next store after ObjectCacheSession clears it.
  private rewind(clear: boolean) {
    if (this.closing.signal.aborted) return;
    this.rewound = this.pending.dropUnsent();
    if (clear) this.cachedObjects.clear();
    // After rewound is set: work the abort cuts short answers timeline-changed (halted).
    this.closing.abort();
    for (const listener of this.rewoundListeners) listener(this.rewound);
  }

  private adopt(timeline: string) {
    this.timeline = timeline;
    this.cachedObjects.adopt(timeline);
  }

  private cacheKnown(since: number, known = this.known) {
    return this.cachedObjects.enabled ? known : since;
  }

  readonly subscribe = this.changes.subscribe;
  readonly waiting = this.connection.waiting;

  // Writes shown or waiting their turn that the server has not taken yet: a page closed now loses them.
  readonly unsentWrites = this.pending.count;

  readonly subscribeWaiting = this.connection.subscribe;

  capture<T>(read: () => T): { value: T; reads: StoreRead[] } {
    return this.changes.capture(read);
  }

  get<K extends Kind>(kind: K, id: string): Stored<K> | null {
    this.changes.read({ kind, id });
    const held = this.pending.shown(id);
    const parent = this.pending.parent(id);
    if (SCOPED.has(kind) && (!parent || this.scopeState(parent) !== 'loaded')) throw new ScopeUnavailable(parent ?? null);
    return held && held.kind === kind && held.value !== undefined ? (held as Stored<K>) : null;
  }

  list<K extends Kind>(kind: K): Stored<K>[] {
    if (SCOPED.has(kind)) throw new ScopeUnavailable(null);
    this.changes.read({ kind, list: true });
    return this.pending.shownOf(this.objects.ids(kind), (held) => held.kind === kind);
  }

  children<K extends Kind>(kind: K, parent: string): Stored<K>[] {
    if (SCOPED.has(kind) && this.scopeState(parent) !== 'loaded') throw new ScopeUnavailable(parent);
    this.changes.read({ kind, parent });
    return this.pending.shownOf(this.objects.ids(kind, parent), (held) => held.kind === kind && held.parent === parent);
  }

  shownMark(chat: string): number {
    return this.pending.mark(chat);
  }

  private show(pending: Pending, commit: PendingCommit) {
    // As hold keeps them: a chat's entries and memory only while the chat is held, a walked kind's rows never.
    if (WALKED.has(pending.kind) || (SCOPED.has(pending.kind) && !(pending.parent && this.scopes.has(pending.parent)))) return;
    this.marked(commit.show(pending));
  }

  private unshow(id: string, commit: PendingCommit) {
    const overlay = commit.unshow(id);
    if (overlay) this.marked(overlay);
  }

  private marked(overlay: Overlay) {
    const { id, kind, parent } = overlay;
    if (!SCOPED.has(kind) || (parent && this.scopeState(parent) === 'loaded')) this.changes.add({ kind, id, parent });
    const chat = chatOf(overlay);
    if (!chat) return;
    if (kind === 'entry') this.scopes.get(chat)?.fold.changed(id);
  }

  close() {
    this.closing.abort();
    this.codec.close();
    this.evaluation.close();
    for (const scope of this.scopes.values()) scope.abort.abort();
    this.changes.close();
    this.rewoundListeners.clear();
    this.objects.clear();
    this.pending.close();
    this.projections.close();
    this.scopes.clear();
  }

  scopeState(chat: string): ScopeState {
    return this.scopes.get(chat)?.state ?? 'unloaded';
  }

  scopeError(chat: string): ApiFailure | null {
    return this.scopes.get(chat)?.error ?? null;
  }

  entryHead(chat: string): number {
    return this.objects.entryHead(chat);
  }

  loadedHead(chat: string): number {
    return this.scopes.get(chat)?.head ?? 0;
  }

  revision(read: StoreRead): number {
    return this.objects.revision(read);
  }

  private chatFold(chat: string) {
    return new ChatFold((id) => {
      const held = this.pending.shown(id);
      return held?.kind === 'entry' && held.parent === chat && held.value !== undefined ? held as Stored<'entry'> : null;
    });
  }

  foldedChat(chat: string) {
    if (this.scopeState(chat) !== 'loaded') throw new ScopeUnavailable(chat);
    return this.scopes.get(chat)!.fold.snapshot();
  }

  // A held chat that could not be opened or evaluated: its screen says so and offers 다시 시도 (useChatModel).
  private failScope(chat: string, scope: Scope, error: unknown): ApiFailure {
    const failure = this.codecFailure(error);
    if (this.scopes.get(chat) === scope && !this.closing.signal.aborted) {
      scope.state = 'failed';
      scope.error = failure;
      this.scopeChanged(chat);
    }
    return failure;
  }

  // created skips pulling a new id. summarize catches up stale summaries, except batched summary passes
  // which write their own (withChats/saveSummaries).
  retainChat(chat: string, { created = false, summarize = true }: { created?: boolean; summarize?: boolean } = {}): ChatLease {
    if (this.closing.signal.aborted) return { ready: Promise.resolve(this.halted()), release: () => {} };
    let scope = this.scopes.get(chat);
    if (!scope) {
      scope = { fold: this.chatFold(chat), opening: null, abort: new AbortController(), state: created ? 'loaded' : 'unloaded', users: 0, cursor: 0, head: 0, loading: null, error: null, summarize };
      this.scopes.set(chat, scope);
      if (created) this.cacheWrite([], { chat, cursor: scope.cursor, complete: true });
    }
    scope.users++;
    const held = scope;
    // A chat opened for a pass that then writes no summary (stopped, or another of its window failed to open) still
    // gets one when a later holder asked for it: that holder's screen shows the chat in the list.
    if (summarize && !held.summarize) {
      held.summarize = true;
      void (held.opening ?? Promise.resolve(null)).then((failure) => { if (!failure && this.scopes.get(chat) === held) this.projections.summarizeChat(chat); });
    }
    if (held.state !== 'loaded' && !held.opening) {
      const opening = this.openChat(chat, held, summarize).catch((error: unknown) => this.failScope(chat, held, error)).finally(() => { if (held.opening === opening) held.opening = null; });
      held.opening = opening;
    }
    const ready = held.opening ?? (held.loading ? Promise.resolve(null) : this.projections.evaluate(chat).then(() => null, (error: unknown) => this.codecFailure(error)));
    let released = false;
    return { ready, release: () => {
      if (released) return;
      released = true;
      held.users--;
      if (!held.users) this.releaseChat(chat, held);
    } };
  }

  private async openChat(chat: string, scope: Scope, summarize: boolean): Promise<ApiFailure | null> {
    const signal = AbortSignal.any([scope.abort.signal, this.closing.signal]);
    scope.state = 'loading';
    this.scopeChanged(chat);
    await this.cachedObjects.settled;
    const saved = await this.cachedObjects.read(chat);
    if (signal.aborted || this.scopes.get(chat) !== scope) return this.halted();
    if (saved) {
      scope.cursor = saved.state.cursor;
      const rows = saved.changes.sort((a, b) => a.rev - b.rev);
      const opened = this.opener(rows, true, signal);
      for (const [index, row] of rows.entries()) {
        await this.apply(row, () => opened(index), true, signal);
        if (signal.aborted) return this.halted();
        if (row.body && this.objects.get(row.id)?.value === undefined) {
          scope.state = 'failed';
          scope.error = { ok: false, error: 'unreadable' };
          this.scopeChanged(chat);
          return scope.error;
        }
      }
      if (signal.aborted) return this.halted();
      if (saved.state.complete && !saved.changes.some((row) => row.omitted)) {
        scope.state = 'loaded';
        await this.projections.evaluate(chat);
        this.scopeChanged(chat);
        // Ready is cache-only; catch-up and summary writes must not hold the chat screen behind the network.
        void this.refreshChat(chat).then((failure) => { if (!failure && scope.users && summarize) this.projections.summarizeChat(chat); });
        return null;
      }
    }
    const failure = await this.refreshChat(chat);
    return failure ?? (summarize ? await this.projections.save(chat) : null);
  }

  // What an operation answers when it is cut short: timeline-changed once the store ended for a restore, stopped for the
  // store closing, the caller's own stop and a released lease.
  private halted(): ApiFailure {
    return { ok: false, error: this.rewound !== null ? 'timeline-changed' : 'stopped' };
  }

  private codecFailure(error: unknown): ApiFailure {
    if (error instanceof EvaluationStopped || error instanceof CodecAborted) return this.halted();
    if (error instanceof EvaluationStuck) return { ok: false, error: 'bot-stuck' };
    if (error instanceof EvaluationFailed) return { ok: false, error: 'evaluation-unavailable' };
    if (error instanceof CodecUnavailable) return { ok: false, error: 'codec-unavailable' };
    throw error;
  }

  // signal: the caller's stop, which lets the chat go at once, ending its opening and a summary write waiting on the
  // connection; what run does with the chat after that ends as stopped (ChatProjections.save).
  withChat<T>(chat: string, run: () => Promise<ApiResult<T>>, signal?: AbortSignal): Promise<ApiResult<T>> {
    return this.withChats([chat], (_, [passed]) => (passed ? Promise.resolve(passed) : run()), { signal });
  }

  // Hold/open chats together. Skip/report unreadable or still-stuck chats, whose screens show failures;
  // other open failures abort the pass. signal releases every lease; summarize follows retainChat.
  async withChats<T>(chats: string[], run: (readable: string[], passed: ApiFailure[]) => Promise<ApiResult<T>>, { signal, summarize = true }: { signal?: AbortSignal; summarize?: boolean } = {}): Promise<ApiResult<T>> {
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    const leases = chats.map((chat) => this.retainChat(chat, { summarize }));
    const release = () => { for (const lease of leases) lease.release(); };
    signal?.addEventListener('abort', release, { once: true });
    try {
      const readable: string[] = [];
      const passed: ApiFailure[] = [];
      for (const [index, lease] of leases.entries()) {
        const failure = await lease.ready;
        if (signal?.aborted) return { ok: false, error: 'stopped' };
        if (!failure) readable.push(chats[index]!);
        else if (failure.error === 'unreadable' || failure.error === 'bot-stuck') passed.push(failure);
        else return failure;
      }
      return await run(readable, passed);
    } finally { signal?.removeEventListener('abort', release); release(); }
  }

  refreshChat(chat: string): Promise<ApiFailure | null> {
    const scope = this.scopes.get(chat);
    if (!scope) throw new ScopeUnavailable(chat);
    if (scope.loading) return scope.loading;
    if (scope.state !== 'loaded') scope.state = 'loading';
    scope.error = null;
    const stop = AbortSignal.any([scope.abort.signal, this.closing.signal]);
    scope.loading = this.pullParent(chat, scope, stop).catch((error: unknown) => this.codecFailure(error)).then(async (failure) => {
      if (stop.aborted || this.scopes.get(chat) !== scope) return this.halted();
      scope.error = failure;
      scope.state = failure && (scope.state !== 'loaded' || failure.error === 'unreadable') ? 'failed' : 'loaded';
      scope.loading = null;
      if (!failure) {
        try { await this.projections.evaluate(chat); }
        catch (error) { failure = this.codecFailure(error); }
      }
      this.scopeChanged(chat);
      return failure;
    });
    this.scopeChanged(chat);
    return scope.loading;
  }

  private releaseChat(chat: string, scope: Scope) {
    scope.abort.abort();
    scope.loading = null;
    for (const kind of SCOPED) {
      for (const id of [...(this.objects.ids(kind, chat) ?? [])]) this.objects.forget(id);
    }
    this.projections.release(chat);
    for (const asker of ['headless', 'send', 'forecast', 'memory', 'view'] as const) this.evaluation.forget({ asker, chat });
    scope.state = 'unloaded';
    scope.cursor = 0;
    scope.head = 0;
    scope.error = null;
    if (this.scopes.get(chat) === scope) this.scopes.delete(chat);
    this.scopeChanged(chat);
  }

  // An explicit account/parent walk; it never fills the held chat scopes. Backup, ownership and ledger-fill walks run on
  // their workflow's pin (pinned). No row is visited once the store has ended.
  async scan(options: { parent?: string; kind?: Kind; metadata?: boolean }, visit: (row: ObjectRow, value: unknown) => void | Promise<void>, pin: Pin, signal?: AbortSignal): Promise<ApiFailure | null> {
    const walked = await this.pages(options, 0, visit, pin, signal);
    return walked.ok ? null : walked;
  }

  // Walk cached parent rows then server revisions after the cursor; never populate held scopes.
  // since 0 includes cached rows, otherwise only newer rows; return the next cursor.
  async walk(parent: string, kind: Kind, visit: (row: ObjectRow, value: unknown) => void, since: number, pin: Pin, signal?: AbortSignal): Promise<ApiResult<number>> {
    const stop = AbortSignal.any([this.closing.signal, ...(signal ? [signal] : [])]);
    let cursor = since;
    if (!cursor) {
      await this.cachedObjects.settled;
      const saved = await this.cachedObjects.read(parent);
      if (stop.aborted) return this.halted();
      if (saved) {
        // An omitted row is the feed's, past the cursor, and read from the server below.
        const rows = saved.changes.filter((row) => row.kind === kind && row.body);
        const opened = this.opener(rows, true, stop, true);
        for (const [index, row] of rows.entries()) {
          let value: unknown;
          try {
            value = await opened(index);
          } catch (error) {
            return this.codecFailure(error);
          }
          if (stop.aborted) return this.halted();
          visit({ id: row.id, kind: row.kind, parent: row.parent, rev: row.rev }, upgradeValue(row.kind, value) ?? value);
        }
        cursor = saved.state.cursor;
      }
    }
    return this.pages({ parent, kind }, cursor, visit, pin, signal, (changes, at, more) => this.cacheWrite(changes, { chat: parent, cursor: at, complete: !more }));
  }

  private async pages(options: { parent?: string; kind?: Kind; metadata?: boolean }, since: number, visit: (row: ObjectRow, value: unknown) => void | Promise<void>, pin: Pin, signal?: AbortSignal, paged?: (changes: SealedChange[], cursor: number, more: boolean) => void): Promise<ApiResult<number>> {
    const stop = AbortSignal.any([this.closing.signal, ...(signal ? [signal] : [])]);
    let cursor = since;
    let more = true;
    while (more) {
      if (stop.aborted) return this.halted();
      const result = await this.backend.feed(feedQuery({ since: cursor, timeline: pin.timeline, parent: options.parent ?? null, kind: options.kind ?? null, metadata: options.metadata ?? false }), stop);
      if (stop.aborted) return this.halted();
      if (!result.ok) {
        if (result.error !== 'cache-reset') return result;
        this.rewind(true);
        return this.halted();
      }
      this.limits = result.data.limits;
      const opened = this.opener(result.data.changes, true, stop, true);
      for (const [index, { body, omitted, ...row }] of result.data.changes.entries()) {
        if (stop.aborted) return this.halted();
        if (body === null) continue;
        let value: unknown;
        try {
          value = omitted ? undefined : await opened(index);
        } catch (error) {
          return this.codecFailure(error);
        }
        value = upgradeValue(row.kind, value) ?? value;
        if (stop.aborted) return this.halted();
        // Awaited, so a slow visitor holds the walk; no next codec window starts ahead of its demand.
        await visit(row, value);
      }
      if (stop.aborted) return this.halted();
      cursor = result.data.cursor;
      more = result.data.more;
      paged?.(result.data.changes, cursor, more);
    }
    return { ok: true, data: cursor };
  }

  async removeRows(rows: ObjectRow[]): Promise<ApiResult<null>> {
    const removed = await this.commit(rows.map((row) => this.writes.remove(row)));
    return removed.ok ? { ok: true, data: null } : removed;
  }

  // The objects held in a shape upgraded as they were read (runtime/upgrade), each handed out once.
  takeUpgraded(): { id: string; kind: string }[] {
    const taken = [...this.upgraded].map(([id, kind]) => ({ id, kind }));
    this.upgraded.clear();
    return taken;
  }

  unreadable(): number {
    return this.objects.unreadable();
  }

  // A store holding no timeline pulls one first, as one about to write does.
  async pin(signal?: AbortSignal): Promise<ApiResult<Pin>> {
    if (!this.limits || this.timeline === null) {
      const failure = await this.reaching(() => this.pull(), signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal);
      if (failure) return failure;
    }
    return this.closing.signal.aborted ? this.halted() : { ok: true, data: { timeline: this.timeline! } };
  }

  // Pin multi-request workflows to one timeline. Pass the pin to scans; store writes end with that timeline too,
  // so no partial backup/move/removal/turn can continue onto a restored account.
  async pinned<T>(run: (pin: Pin) => Promise<T>, signal?: AbortSignal): Promise<T | ApiFailure> {
    const pin = await this.pin(signal);
    return pin.ok ? run(pin.data) : pin;
  }

  // Concurrent callers share a pull; its initiator owns cancellation and progress.
  pull(options: PullOptions = {}): Promise<ApiFailure | null> {
    if (this.openingFailure) return Promise.resolve(this.openingFailure);
    if (!this.pulling) {
      // The opening pull runs before the shell holds the store, so waiting for the connection rides on its progress.
      const { progress } = options;
      let last: PullProgress = { objects: 0, pages: 0, waiting: false };
      const report = progress && ((next: PullProgress) => progress((last = next)));
      const unwatch = report ? this.subscribeWaiting(() => report({ ...last, waiting: this.waiting() })) : () => {};
      this.pulling = this.pullPages({ ...options, progress: report }).catch((error: unknown) => this.codecFailure(error)).finally(() => {
        unwatch();
        this.pulling = null;
      });
    }
    return this.pulling;
  }

  // Preserve within-kind order and write children before owners, owners in the last request.
  // Interrupted multi-request actions leave only unreachable pieces. unheld delegates leases/summaries to restore/move;
  // caller cancellation also ends connection waits.
  async batch(writes: Write[], progress: (write: Write) => void = () => {}, { unheld = false, signal }: { unheld?: boolean; signal?: AbortSignal } = {}): Promise<ApiResult<null>> {
    const { ordered, chats } = this.writes.arrange(writes, unheld);
    // Every touched chat stays held until its summary is written; entries held without a scope would never be let go.
    const leases = chats.map(({ chat, created }) => this.retainChat(chat, { created }));
    try {
      for (const lease of leases) {
        const failure = await lease.ready;
        if (failure) return failure;
      }
      const result = await this.commit(ordered.map((write) => this.writes.step(write)), (index) => progress(ordered[index]!), signal);
      if (!result.ok) return result;
      if (!unheld) this.projections.summarizeHeld();
      return { ok: true, data: null };
    } finally {
      for (const lease of leases) lease.release();
    }
  }

  // Reusing the id makes a create idempotent when its successful response was lost.
  create<K extends Exclude<Kind, Singleton>>(kind: K, value: Values[K], { id = crypto.randomUUID(), parent = null }: { id?: string; parent?: string | null } = {}): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.writes.step({ type: 'create', kind, id, parent, value }), SCOPED.has(kind) ? parent : null);
  }

  // Preserve the live parent; updates never move or resurrect objects. A null change also fails as 'gone'.
  update<K extends Exclude<Kind, AppendOnly>>(kind: K, id: string, change: (current: Values[K]) => Values[K] | null): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.writes.update(kind, id, change), SCOPED.has(kind) ? this.objects.get(id)?.parent ?? null : null);
  }

  // A singleton lives at the id its kind names, and current is undefined until it is first written.
  upsert<K extends Singleton>(kind: K, change: (current: Values[K] | undefined) => Values[K]): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.writes.upsert(kind, change), null);
  }

  // Writes a snapshot back (되돌리기, and a backup's objects): over the live object, or in place of a deleted
  // one at the rev its deletion took, under the parent it had.
  restore<K extends Kind>({ id, kind, parent, value }: Stored<K>): Promise<ApiResult<Stored<K>>> {
    return this.writeOne<K>(this.writes.step({ type: 'restore', id, kind, parent, value }), SCOPED.has(kind) ? parent : null);
  }

  async remove(id: string): Promise<ApiResult<null>> {
    return this.batch([{ type: 'remove', id }]);
  }

  async take<K extends Kind>(kind: K, id: string): Promise<ApiResult<Stored<K>>> {
    const object = this.get(kind, id);
    if (!object) return { ok: false, error: 'gone' };
    const removed = await this.remove(id);
    return removed.ok ? { ok: true, data: object } : removed;
  }

  // chat: a scoped write's chat, held for the base revision of what the write changes.
  private async writeOne<K extends Kind>(step: WriteStep, chat: string | null): Promise<ApiResult<Stored<K>>> {
    const lease = chat ? this.retainChat(chat) : null;
    try {
      // Never await without a lease: commit shows the write, and a create must be readable as its call returns.
      if (lease) {
        const failure = await lease.ready;
        if (failure) return failure;
      }
      const result = await this.one<K>(step);
      if (result.ok) this.projections.summarizeHeld();
      return result;
    } finally {
      lease?.release();
    }
  }

  // Do not inline into writeOne: this promise boundary orders completion against read-model updates.
  private async one<K extends Kind>(step: WriteStep): Promise<ApiResult<Stored<K>>> {
    const result = await this.commit([step]);
    return result.ok ? { ok: true, data: result.data[0] as Stored<K> } : result;
  }

  private async retry<T>(attempt: () => Promise<ApiResult<T>>, stop: AbortSignal): Promise<ApiResult<T>> {
    for (let tries = 0; tries < MAX_ATTEMPTS; tries++) {
      const result = await this.reaching(attempt, stop);
      if (result.ok || result.error !== 'conflict') return result;
      const failure = await this.reaching(() => this.pull(), stop);
      if (failure) return failure;
    }
    return { ok: false, error: 'conflict' };
  }

  // Reads and writes wait through outages, restores and store wake-up until cancellation, as file uploads do.
  // Lost write responses cause conflict retries: changes must be idempotent (set values, never increment them).
  async reaching<R extends ApiResult<unknown> | null>(attempt: (signal: AbortSignal) => Promise<R>, stop: AbortSignal = this.closing.signal): Promise<R | ApiFailure> {
    return this.connection.run(attempt, stop);
  }

  private async commit(steps: WriteStep[], progress: (index: number) => void = () => {}, signal?: AbortSignal): Promise<ApiResult<(Held | null)[]>> {
    const stop = signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal;
    if (stop.aborted) return this.halted();
    const saved: (Held | null)[] = [];
    const commit = this.pending.begin(steps.map((step) => step.id), () => steps.slice(saved.length).filter((step) => !step.derived).length);
    try {
      // Shown before the wait for an earlier write to the same object, applied to what reads show: the real resolve,
      // against live, runs inside send.
      for (const step of steps) {
        if (step.derived) continue;
        let preview: ApiResult<Resolved>;
        try { preview = step.resolve((id) => this.pending.shown(id)); } catch { continue; }
        if (preview.ok && preview.data.pending) this.show(preview.data.pending, commit);
      }
      if (commit.visible) {
        this.changes.publish();
        this.projections.refreshHeld();
      }
      if (commit.blocked && !(await commit.wait(stop))) return this.halted();
      return await this.send(steps, saved, progress, stop, commit);
    } catch (error) {
      return this.codecFailure(error);
    } finally {
      commit.release();
      // A write that failed for good shows the confirmed copy again; its caller still gets the failure.
      if (commit.visible) {
        for (const overlay of commit.hide()) this.marked(overlay);
        this.changes.publish();
        this.projections.refreshHeld();
      }
    }
  }

  private async send(steps: WriteStep[], saved: (Held | null)[], progress: (index: number) => void, stop: AbortSignal, commit: PendingCommit): Promise<ApiResult<(Held | null)[]>> {
    const pinned = await this.pin(stop);
    if (!pinned.ok) return pinned;
    const { timeline } = pinned.data;
    const limits = this.limits!;
    while (saved.length < steps.length) {
      const start = saved.length;
      // Requests are counted from the back, so the last one is full: an owner, written last, goes with the owned objects
      // just before it (runtime/characters addCharacter puts a move's chat roots there).
      const end = start + ((steps.length - start - 1) % limits.items) + 1;
      const result = await this.retry(async (): Promise<ApiResult<(Held | null)[]>> => {
        const prepared = await this.writes.prepare(steps, { start, end, limits, timeline, signal: stop });
        if (!prepared.ok) return prepared;
        const { resolved, writes, files } = prepared.data;
        if (writes.length) {
          if (stop.aborted) return this.halted();
          const answer = await this.backend.batch(timeline, writes, files, stop);
          // Only the store ending drops an answer: a caller's stop that arrives after the write landed keeps it held.
          if (this.closing.signal.aborted) return this.halted();
          if (!answer.ok) {
            if (answer.error !== 'cache-reset') return answer;
            this.rewind(true);
            return this.halted();
          }
          let index = 0;
          for (const ready of resolved) {
            if (!ready.pending) continue;
            const { id, kind, parent, value } = ready.pending;
            const rev = answer.data.revs[index++]!;
            if (value === undefined) this.drop(id, rev, { kind, id, parent });
            else {
              ready.held = { id, kind, parent, value, rev };
              this.hold(ready.held);
            }
          }
          // A once write may answer the rev of a row already there with another body (a branch's copy of its original's
          // call): only the walk, which reads it from the server past its cursor, caches it.
          this.cacheWrite(writes.flatMap(({ id, kind, parent, body, once }, index) => (once ? [] : [{ id, kind, parent, body, rev: answer.data.revs[index]! }])));
        }
        for (let index = 0; index < resolved.length; index++) this.unshow(steps[start + index]!.id, commit);
        this.changes.publish();
        return { ok: true, data: resolved.map(({ held }) => held) };
      }, stop);
      if (!result.ok) return this.closing.signal.aborted ? this.halted() : result;
      saved.push(...result.data);
      for (let index = start; index < saved.length; index++) progress(index);
    }
    this.projections.refreshHeld();
    return { ok: true, data: saved };
  }

  private async pullPages({ signal = this.closing.signal, progress }: PullOptions): Promise<ApiFailure | null> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    let more = true;
    let objects = 0;
    let pages = 0;
    let total: number | undefined;
    let counted = false;
    // The page after the one being applied, requested as soon as that one answered: the server's time and the codec's
    // overlap. It carries the timeline it was sent under.
    let next: { sent: string | null; answer: Promise<ApiResult<FeedAnswer>> } | null = null;
    const page = (since: number, bootstrapped: boolean, known: number) => {
      const sent = this.timeline;
      // Only a bootstrap's first request asks for the count; the prefetched page after it is built before it answers.
      const count = !bootstrapped && !counted;
      counted ||= count;
      const query = feedQuery({ since, known: this.cacheKnown(since, known), timeline: sent, excluded: [...UNFED], bootstrap: !bootstrapped, until: bootstrapped ? null : this.bootstrap, count });
      const answer = this.reaching(() => this.backend.feed(query, stop), stop);
      return { sent, answer };
    };
    while (more) {
      if (stop.aborted) return this.halted();
      const { sent, answer } = next ?? page(this.cursor, this.bootstrapped, this.known);
      next = null;
      const result = await answer;
      if (stop.aborted) return this.halted();
      if (!result.ok) {
        if (result.error !== 'cache-reset') return result;
        this.rewind(true);
        return this.halted();
      }
      // Sent with none, this is a bootstrap from 0 after a reset, and its answer names the timeline to hold. The server
      // refuses a request whose timeline is not its own, so no other answer can name another.
      if (sent === null) this.adopt(result.data.timeline);
      objects += result.data.changes.length;
      total ??= result.data.total;
      progress?.({ objects, pages: ++pages, waiting: this.waiting(), ...(total !== undefined && { total }) });
      this.limits = result.data.limits;
      this.bootstrap ??= result.data.until ?? null;
      // The cursor and bootstrap flag move after the page is applied (pullParent reads them); the next request is
      // computed from the page itself, with the revisions it carries already known.
      const after = { cursor: result.data.cursor, more: result.data.more, bootstrapped: this.bootstrapped };
      if (!after.more && !this.bootstrapped) {
        after.cursor = this.bootstrap ?? after.cursor;
        after.bootstrapped = true;
        after.more = true;
      }
      if (after.more) next = page(after.cursor, after.bootstrapped, result.data.changes.reduce((known, change) => Math.max(known, change.rev), this.known));
      const opened = this.opener(result.data.changes, false, stop);
      for (const [index, change] of result.data.changes.entries()) {
        if (stop.aborted) {
          this.changes.publish();
          return this.halted();
        }
        try {
          await this.apply(change, () => opened(index), false, stop);
        } catch (error) {
          if (error instanceof CodecAborted) this.changes.publish();
          throw error;
        }
      }
      if (result.data.changes.length) this.changes.publish();
      this.cursor = after.cursor;
      this.bootstrapped = after.bootstrapped;
      more = after.more;
      this.cacheWrite(result.data.changes);
    }
    for (const chat of [...this.behind]) {
      this.behind.delete(chat);
      // A chat already loading waits for this pull (pullParent) and reads its parent after it: waiting for it here
      // would wait for this pull itself.
      if (!this.scopes.has(chat) || this.scopes.get(chat)!.loading) continue;
      const failure = await this.refreshChat(chat);
      if (failure) return failure;
    }
    this.projections.refreshHeld();
    return stop.aborted ? this.halted() : null;
  }

  private async pullParent(chat: string, scope: Scope, signal: AbortSignal): Promise<ApiFailure | null> {
    if (!this.bootstrapped) {
      const failure = await this.pull();
      if (failure) return failure;
    }
    let more = true;
    while (more) {
      if (signal.aborted) return this.halted();
      const query = feedQuery({ since: scope.cursor, known: this.cacheKnown(scope.cursor), parent: chat, timeline: this.timeline! });
      const result = await this.reaching(() => this.backend.feed(query, signal), signal);
      if (signal.aborted) return this.halted();
      if (!result.ok) {
        if (result.error !== 'cache-reset') return result;
        this.rewind(true);
        return this.halted();
      }
      this.limits = result.data.limits;
      const opened = this.opener(result.data.changes, true, signal);
      for (const [index, change] of result.data.changes.entries()) {
        if (signal.aborted) return this.halted();
        await this.apply(change, () => opened(index), true, signal);
        if (change.body && SCOPED.has(change.kind) && this.objects.get(change.id)?.value === undefined) return { ok: false, error: 'unreadable' };
      }
      if (signal.aborted) return this.halted();
      scope.cursor = result.data.cursor;
      more = result.data.more;
      this.cacheWrite(result.data.changes, { chat, cursor: scope.cursor, complete: scope.state === 'loaded' || !more });
    }
    return null;
  }

  private opener(rows: SealedChange[], scoped: boolean, signal: AbortSignal, strict = false) {
    return this.codec.opener(rows, signal, { strict, accept: ({ id, kind, rev }) =>
      (scoped || !UNFED.has(kind)) && !this.objects.stale(id, rev),
    });
  }

  private async apply({ id, kind, parent, rev, body, omitted }: SealedChange, opened: () => Promise<unknown>, scoped: boolean, signal: AbortSignal) {
    if (signal?.aborted || this.closing.signal.aborted) return;
    this.recordRevision({ id, kind, parent, rev });
    if (scoped && kind === 'entry' && parent) {
      const scope = this.scopes.get(parent)!;
      scope.head = Math.max(scope.head, rev);
    }
    if (omitted || (UNFED.has(kind) && !scoped)) {
      if (!parent || this.scopeState(parent) !== 'loaded') this.changes.add({ id, kind, parent });
      // This device's own writes come back here too, and are already held.
      else if (!this.objects.stale(id, rev)) this.behind.add(parent);
      return;
    }
    if (this.objects.stale(id, rev)) return;
    if (body === null) return this.drop(id, rev, { kind, id, parent });
    const value = await opened();
    const upgraded = upgradeValue(kind, value);
    if (signal.aborted || this.closing.signal.aborted) return;
    if (upgraded) this.upgraded.set(id, kind);
    this.hold({ id, kind, parent, rev, value: upgraded ?? value });
  }

  private hold(object: Held) {
    this.recordRevision(object);
    if (object.kind === 'entry' && object.parent) {
      const scope = this.scopes.get(object.parent);
      if (scope) scope.head = Math.max(scope.head, object.rev);
    }
    if (this.closing.signal.aborted || this.objects.stale(object.id, object.rev)) return;
    if (WALKED.has(object.kind)) return this.changes.add({ kind: object.kind, id: object.id, parent: object.parent });
    // A chat's entries and memory stay in memory only while the chat is held.
    if (SCOPED.has(object.kind) && !(object.parent && this.scopes.has(object.parent))) return;
    const previous = this.objects.get(object.id);
    if (previous?.kind === 'entry' && previous.parent) this.scopes.get(previous.parent)?.fold.changed(object.id);
    if (object.kind === 'entry' && object.parent) this.scopes.get(object.parent)?.fold.changed(object.id);
    if (previous && (previous.kind !== object.kind || previous.parent !== object.parent)) this.changes.add({ kind: previous.kind, id: previous.id, parent: previous.parent });
    if (!SCOPED.has(object.kind) || (object.parent && this.scopeState(object.parent) === 'loaded')) this.changes.add({ kind: object.kind, id: object.id, parent: object.parent });
    this.objects.hold(object);
  }

  private drop(id: string, rev: number, change: StoreChange) {
    this.recordRevision({ ...change, rev });
    if (change.kind === 'entry' && change.parent) {
      const scope = this.scopes.get(change.parent);
      if (scope) scope.head = Math.max(scope.head, rev);
    }
    if (this.objects.stale(id, rev)) return;
    const previous = this.objects.get(id);
    if (change.kind === 'entry' && change.parent) this.scopes.get(change.parent)?.fold.changed(id);
    this.changes.add(previous ? { kind: previous.kind, id, parent: previous.parent } : change);
    this.objects.drop(id, rev);
  }

  private recordRevision(change: StoreChange & { rev: number }) {
    this.known = Math.max(this.known, change.rev);
    this.objects.recordRevision(change);
  }

  private scopeChanged(chat: string) {
    this.changes.add({ kind: 'scope', id: chat, parent: chat });
    this.changes.publish();
  }
}

export function keepSynced(store: ObjectStore, synced: () => void): () => void {
  const pull = () => {
    if (document.visibilityState === 'visible') void store.pull().then((failure) => { if (!failure) synced(); });
  };
  const timer = setInterval(pull, 30_000);
  window.addEventListener('focus', pull);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', pull);
  };
}
