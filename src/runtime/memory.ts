import { entryName } from '../connectors/types';
import { ChangeSignal } from '../change-signal';
import { chatMemory, memoryOwner, memorySetup, sourcesOf, storedMemory } from './memory-read';
import { chatSent, type ChatSent } from './memory-view';
import { MemorySchedule, type MemoryCheck } from './memory-schedule';
import type { ModelSettings } from '../connectors/settings';
import { chapterCap, chapterTarget, coveredBy, fingerprint, isChapter, memoryBudget, nextChapters, nextSpan, owned, parseChapter, parseRecords, placesOf, rawParts, staleness, threadLabel, type Drafted, type Invalid, type Scene } from '../engine/memory';
import type { RanAway } from '../engine/pipeline';
import { fold, shown, type Chat, type Message, type Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import { emptyMemory, memoryId, type Chapter, type Fact, type Memory, type MemoryRecord, type MemorySettings, type Source, type Thread, type Written } from '../model/memory';
import type { MemoryPrompt } from '../model/prompt';
import type { Stream } from '../model/stream';
import { EMPTY_SETTINGS } from '../model/settings';
import type { ApiFailure, ApiResult } from './api';
import { retriesOf } from './connections';
import { evaluationFailure } from './evaluation';
import type { Route, RouteFailure } from './assignment';
import { gather, generate, receiptOf, resume, unsettled, type Reply } from './generate';
import { taskWriter } from './profiles';
import { memoryPrompt } from './prompts';
import type { Session } from './session';
import { without } from '../model/fields';
import type { ObjectStore } from './store';
import { callOf, endCall, newCall, type CallTarget } from './streams';
import { chatPlace, keepRow } from './usage';
import { tokenLimits, promptBudget, sentSettings } from './chat-context';
import { wouldSend } from './turn-context';
import { indexRecords, unembedded, type Indexed } from './retrieval';

// The only writer of `memory` objects and of the memory settings (design §6.2).

// null: 공용으로 되돌리기.
export const setChatMemory = (store: ObjectStore, chat: string, settings: MemorySettings | null) =>
  store.update('chat', chat, (current) => (settings === null ? without(current, 'memory') : { ...current, memory: settings }));

export const setDefaultMemory = (store: ObjectStore, change: Partial<MemorySettings>) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, memory: { ...current.memory, ...change } }));

type Write<T = Stored<'memory'>> = Promise<ApiResult<T>>;

// null means 'gone', with no write. A concurrent create on another device becomes an update.
async function changeMemory(store: ObjectStore, chat: string, change: (memory: Memory) => Memory | null): Write {
  return store.withChat(chat, async () => {
    const id = memoryId(chat);
    if (!storedMemory(store, chat)) {
      const value = change(emptyMemory());
      if (value === null) return { ok: false, error: 'gone' };
      const created = await store.create('memory', value, { id, parent: chat });
      if (created.ok || created.error !== 'conflict' || !storedMemory(store, chat)) return created;
    }
    return store.update('memory', id, change);
  });
}

// The writers below that take a record's id take a chapter's too.
type ItemChange = <T extends MemoryRecord | Chapter>(item: T) => T;

function changed(memory: Memory, id: string, change: ItemChange): Memory | null {
  const record = memory.records.findIndex((each) => each.id === id);
  if (record !== -1) return { ...memory, records: memory.records.with(record, change(memory.records[record]!)) };
  const chapter = memory.chapters.findIndex((each) => each.id === id);
  return chapter === -1 ? null : { ...memory, chapters: memory.chapters.with(chapter, change(memory.chapters[chapter]!)) };
}

const withItem = (store: ObjectStore, chat: string, id: string, change: ItemChange) => changeMemory(store, chat, (memory) => changed(memory, id, change));

export type RecordPatch = Partial<Pick<Written, 'when' | 'where' | 'who' | 'what' | 'lines' | 'outcome'>>;

// Advance at to reject in-flight summaries and flag containing chapters for the user.
export const editRecord = (store: ObjectStore, chat: string, record: string, patch: RecordPatch): Write =>
  withItem(store, chat, record, (current) => ({ ...current, ...patch, edited: true, at: Date.now() }));

// 고정. A pinned record is sent even when stale, which is how the user keeps one as canon.
export const pinRecord = (store: ObjectStore, chat: string, record: string, pinned: boolean): Write =>
  withItem(store, chat, record, (current) => (pinned ? { ...current, pinned: true } : without(current, 'pinned')));

// 이 기억 넣기, on records only.
export const recallRecord = (store: ObjectStore, chat: string, record: string, recalled: boolean): Write =>
  changeMemory(store, chat, (memory) => {
    const at = memory.records.findIndex(({ id }) => id === record);
    const current = memory.records[at];
    return current ? { ...memory, records: memory.records.with(at, recalled ? { ...current, recalled: true } : without(current, 'recalled')) } : null;
  });

// Retries may find the item already removed. Keep its last snapshot and treat that deletion as success.
async function taking<T>(store: ObjectStore, chat: string, find: (memory: Memory) => T | undefined, remove: (memory: Memory, found: T) => Memory): Write<T> {
  let was: T | undefined;
  const saved = await changeMemory(store, chat, (memory) => {
    const found = find(memory);
    if (found === undefined) return was === undefined ? null : memory;
    was = found;
    return remove(memory, found);
  });
  return saved.ok ? { ok: true, data: was! } : saved;
}

export const forgetRecord = (store: ObjectStore, chat: string, record: string): Write<MemoryRecord | Chapter> =>
  taking(
    store,
    chat,
    (memory) => [...memory.records, ...memory.chapters].find(({ id, forgotten }) => id === record && !forgotten),
    (memory, found) => changed(memory, found.id, (item) => ({ ...item, forgotten: true }))!,
  );

// The same id is the same kind.
export const restoreRecord = (store: ObjectStore, chat: string, record: MemoryRecord | Chapter): Write => withItem(store, chat, record.id, <T,>() => record as T);

const sameFact = (a: Pick<Fact, 'about' | 'field'>, b: Pick<Fact, 'about' | 'field'>) => a.about === b.about && a.field === b.field;

// replaces: the about and field of the fact being rewritten, null for a new one. A fact the user writes names no record.
// A rewrite of a fact deleted meanwhile, on another device, is 'gone': an edit never makes it again.
export function setFact(store: ObjectStore, chat: string, fact: Fact, replaces: Pick<Fact, 'about' | 'field'> | null): Write {
  const key = replaces ?? fact;
  const written = { ...fact, record: null };
  return changeMemory(store, chat, (memory) => {
    const kept = memory.state.filter((each) => !sameFact(each, fact) || sameFact(each, key));
    const at = kept.findIndex((each) => sameFact(each, key));
    if (at === -1 && replaces) return null;
    return { ...memory, state: at === -1 ? [...kept, written] : kept.with(at, written) };
  });
}

export const removeFact = (store: ObjectStore, chat: string, fact: Pick<Fact, 'about' | 'field'>): Write<Fact> =>
  taking(
    store,
    chat,
    (memory) => memory.state.find((each) => sameFact(each, fact)),
    (memory, found) => ({ ...memory, state: memory.state.filter((each) => each !== found) }),
  );

// edit: a rewrite of a thread already there, 'gone' once deleted meanwhile; false adds it (되돌리기 after removeThread).
export const setThread = (store: ObjectStore, chat: string, thread: Thread, edit: boolean): Write =>
  changeMemory(store, chat, (memory) => {
    const at = memory.threads.findIndex(({ id }) => id === thread.id);
    if (at === -1 && edit) return null;
    return { ...memory, threads: at === -1 ? [...memory.threads, thread] : memory.threads.with(at, thread) };
  });

export const removeThread = (store: ObjectStore, chat: string, thread: string): Write<Thread> =>
  taking(
    store,
    chat,
    (memory) => memory.threads.find(({ id }) => id === thread),
    (memory, found) => ({ ...memory, threads: memory.threads.filter((each) => each !== found) }),
  );

// Capture source versions and replaced record/chapter at job start. user permits rebuilding user-owned/forgotten work.
// chapter lists resummarized records, null for ordinary records.
type Job = { sources: Source[]; redo: { id: string; at: number; user: boolean } | null; chapter: string[] | null };

// A new chapter takes only records automatic work may still take, in no other chapter; one made again takes its records
// as they are.
function applies(memory: Memory, messages: Message[], { sources, redo, chapter }: Job): boolean {
  const places = placesOf(sourcesOf(messages));
  const showing = sources.every(({ message, version }) => {
    const at = places.get(message);
    return at !== undefined && shown(messages[at]!).id === version;
  });
  if (!showing) return false;
  if (chapter) {
    const records = new Map(memory.records.map((record) => [record.id, record]));
    const held = new Set(memory.chapters.flatMap((each) => (each.id === redo?.id ? [] : each.records.map(({ id }) => id))));
    const free = chapter.every((id) => {
      const record = records.get(id);
      return record !== undefined && !held.has(id) && (redo !== null || (!owned(record) && !record.forgotten));
    });
    return free && (!redo || memory.chapters.find(({ id }) => id === redo.id)?.at === redo.at);
  }
  if (!redo) return coveredBy(memory, places) === places.get(sources[0]!.message);
  const record = memory.records.find(({ id }) => id === redo.id);
  return record !== undefined && record.at === redo.at && (redo.user || (!owned(record) && !record.forgotten));
}

// The records a chapter summarizes again when it is made again: its own, but those the user deleted.
const members = (memory: Memory, chapter: Chapter) => chapter.records.flatMap(({ id }) => (memory.records.find((record) => record.id === id)?.forgotten ? [] : [id]));

// A chapter in its place in chat order, with its records' at as they are; records, state and threads stay as they are.
function withChapter(memory: Memory, { sources, redo }: Job, chapter: string[], scene: Scene, span: { role: string; text: string }[], receipt: Receipt, first: string): Memory {
  const order = new Map(memory.records.map(({ id }, index) => [id, index]));
  const made: Chapter = { id: first, sources, print: fingerprint(span), ...scene, receipt, at: Date.now(), records: chapter.map((id) => ({ id, at: memory.records[order.get(id)!]!.at })) };
  const rest = memory.chapters.filter(({ id }) => id !== redo?.id);
  const place = rest.findIndex(({ records }) => order.get(records[0]!.id)! > order.get(chapter[0]!)!);
  return { ...memory, chapters: place === -1 ? [...rest, made] : rest.toSpliced(place, 0, made) };
}

// A fact a later record or the user set stays as it is. first: the id of the first record, which tells a call already
// saved (Streams). A chapter holding the record summarized again names the new ones with its at, so it waits for the
// user.
function committed(memory: Memory, { sources, redo }: Job, drafts: Drafted[], span: { role: string; text: string }[], receipt: Receipt, first: string): Memory {
  const at = Date.now();
  let from = 0;
  const open = [...memory.threads];
  const made = drafts.map(({ to, when, where, who, what, lines, outcome, state, opens, closes }, index): MemoryRecord => {
    const closed = open.filter((thread) => closesThread(closes, thread)).map(({ text }) => text);
    const record = { id: index === 0 ? first : crypto.randomUUID(), sources: sources.slice(from, to), print: fingerprint(span.slice(from, to)), when, where, who, what, lines, outcome, state, opens, closes: closed, receipt, at };
    from = to;
    return record;
  });
  const place = redo ? memory.records.findIndex(({ id }) => id === redo.id) : memory.records.length;
  const records = [...memory.records.slice(0, place), ...made, ...memory.records.slice(redo ? place + 1 : place)];
  const later = new Set(records.slice(place + made.length).map(({ id }) => id));
  let state = redo ? memory.state.filter(({ record }) => record !== redo.id) : memory.state;
  let threads = redo ? memory.threads.filter(({ opened }) => opened !== redo.id) : memory.threads;
  drafts.forEach((draft, index) => {
    const record = made[index]!.id;
    for (const { about, field, value } of draft.state) {
      const at = state.findIndex((fact) => sameFact(fact, { about, field }));
      const held = state[at];
      if (held && (held.record === null || later.has(held.record))) continue;
      if (value === null) state = state.filter((fact) => fact !== held);
      else state = at === -1 ? [...state, { about, field, value, record }] : state.with(at, { about, field, value, record });
    }
    const kept = threads.filter((thread) => !closesThread(draft.closes, thread));
    const known = new Set(kept.map(({ text }) => sameText(text)));
    threads = [...kept, ...draft.opens.filter((text) => !known.has(sameText(text))).map((text) => ({ id: crypto.randomUUID(), text, opened: record }))];
  });
  const chapters = memory.chapters.map((chapter) =>
    redo && chapter.records.some(({ id }) => id === redo.id) ? { ...chapter, records: chapter.records.flatMap((each) => (each.id === redo.id ? made.map(({ id }) => ({ id, at: each.at })) : [each])) } : chapter,
  );
  return { ...memory, records, chapters, state, threads };
}

// invalid: the call answered, but not with records that pass validation (design §6.2, Validation); its receipt and why.
export type MemoryFailure =
  | RouteFailure
  | { kind: 'prompt-missing' }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt; reason: Invalid }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'embed'; reason: Extract<Indexed, { reason: string }>['reason']; receipt: Receipt | null }
  | RanAway;

export function memoryWriter(store: Pick<ObjectStore, 'get'>, chat: Chat): Tools | MemoryFailure {
  const prompt = memoryPrompt(store);
  if (prompt.kind === 'missing') return { kind: 'prompt-missing' };
  const writer = taskWriter(store, chat, prompt.prompt.value.model);
  return 'kind' in writer ? writer : { prompt: prompt.prompt.value, ...writer };
}

// Failures stay session-local and require retry; chapter failures do not block record summaries.
// Index failures retry on explicit retry/chat open; indexing reports completed/total records.
export type Remembering = { running: ReadonlyMap<string, { model: string; left: number }>; failed: ReadonlyMap<string, MemoryFailure>; chapterFailed: ReadonlyMap<string, MemoryFailure>; indexing: ReadonlyMap<string, { done: number; total: number }>; indexFailed: ReadonlyMap<string, MemoryFailure> };

type Planned = { job: Job; sent: ChatSent; from: number; to: number; memory: Memory; before: Written | null; chapter: { target: number } | null; left: number } & Tools;

type Tools = { prompt: MemoryPrompt; route: Route; settings: ModelSettings };

// done: committed. moved: memory or the messages changed while the call ran, so its result was dropped and the next job
// reads them as they are now. stopped: the session closed; the call's marker stays for the next load.
type Outcome = 'done' | 'moved' | 'stopped' | MemoryFailure;

// One job per chat, reading its predecessor's state. Background summaries follow saves/opens/stale edits,
// never block or cancel sends.
export class Rememberer {
  private closed = false;
  private state: Remembering = { running: new Map(), failed: new Map(), chapterFailed: new Map(), indexing: new Map(), indexFailed: new Map() };
  private readonly changes = new ChangeSignal();
  private readonly schedule = new MemorySchedule();
  // The records of chapters that failed this session, by chat, left out of the next chapter until 다시 시도, so a chapter
  // that keeps failing is not paid for on every check.
  private readonly unchaptered = new Map<string, Set<string>>();
  // Track ended calls separately: rejected results leave no saved outcome, and their markers may land late.
  private readonly ended = new Set<string>();
  private readonly aborts = new Set<AbortController>();
  private readonly stop: () => void;

  constructor(
    private readonly session: Pick<Session, 'store' | 'read' | 'credentials' | 'log' | 'costs' | 'scriptTurns' | 'tokens'>,
    // The calls this page reads (runtime/streams).
    private readonly reading: Set<string>,
  ) {
    // Another device's reply arrives here as entries too; only the device that saved it summarizes new messages, so two
    // open devices do not pay for the same span.
    this.stop = session.store.subscribe((changes) => {
      for (const chat of new Set(changes.flatMap(({ kind, parent }) => (kind === 'entry' && parent ? [parent] : [])))) this.start(chat, 'stale');
    });
  }

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  // Opening a chat tries a failed index pass again; a failed summary waits for 다시 시도.
  check(chat: string) {
    this.change(chat, { indexFailed: null });
    this.start(chat, 'full');
  }

  retry(chat: string) {
    this.unchaptered.delete(chat);
    this.change(chat, { failed: null, chapterFailed: null, indexFailed: null });
    this.start(chat, 'full');
  }

  // 원문에서 다시 만들기: one record or chapter from its source, or the whole chat's memory when record is null, which
  // starts over from no memory at all.
  rebuild(chat: string, record: string | null) {
    this.unchaptered.delete(chat);
    this.change(chat, { failed: null, chapterFailed: null });
    if (record === null) {
      this.schedule.rebuild(chat, null);
      void changeMemory(this.session.store, chat, () => emptyMemory()).then(() => this.start(chat, 'full'));
      return;
    }
    this.schedule.rebuild(chat, record);
    this.start(chat, 'full');
  }

  // A summary the server was making when this page came, which Streams hands over. Waits while the chat has a job
  // running; the next pick-up offers it again.
  resume(stream: Stored<'stream'>) {
    const chat = stream.parent!;
    const purpose = stream.value.for;
    if (this.ended.has(stream.id)) return endCall(this.session.store, stream.id);
    if (this.closed || purpose.kind !== 'memory' || !this.schedule.begin(chat, 'stale')) return;
    this.change(chat, { running: { model: stream.value.call.modelName, left: 1 } });
    void this.hold(chat, () => this.resumed(chat, stream, purpose)).finally(() => this.done(chat));
  }

  close() {
    this.closed = true;
    this.stop();
    for (const abort of this.aborts) abort.abort();
  }

  private change(chat: string, change: { running?: { model: string; left: number } | null; failed?: MemoryFailure | null; chapterFailed?: MemoryFailure | null; indexing?: { done: number; total: number } | null; indexFailed?: MemoryFailure | null }) {
    const next = { running: new Map(this.state.running), failed: new Map(this.state.failed), chapterFailed: new Map(this.state.chapterFailed), indexing: new Map(this.state.indexing), indexFailed: new Map(this.state.indexFailed) };
    if (change.running === null) next.running.delete(chat);
    else if (change.running) next.running.set(chat, change.running);
    if (change.failed === null) next.failed.delete(chat);
    else if (change.failed) next.failed.set(chat, change.failed);
    if (change.chapterFailed === null) next.chapterFailed.delete(chat);
    else if (change.chapterFailed) next.chapterFailed.set(chat, change.chapterFailed);
    if (change.indexing === null) next.indexing.delete(chat);
    else if (change.indexing !== undefined) next.indexing.set(chat, change.indexing);
    if (change.indexFailed === null) next.indexFailed.delete(chat);
    else if (change.indexFailed) next.indexFailed.set(chat, change.indexFailed);
    this.state = next;
    this.changes.notify();
  }

  private start(chat: string, check: MemoryCheck) {
    if (this.closed || this.state.failed.has(chat) || (check === 'stale' && this.session.store.scopeState(chat) !== 'loaded')) return;
    if (this.schedule.queue(chat, check)) return;
    const stored = live(this.session.store.get('chat', chat));
    // A chat whose memory slot a tool holds keeps its records as they are, unsummarized, until the slot is the built-in
    // memory's again (design §6.10).
    if (!stored || memoryOwner(this.session.store, stored.value)?.kind !== 'built-in' || (check === 'stale' && !chatMemory(this.session.store, chat).records.length)) return;
    this.schedule.begin(chat, check);
    void this.hold(chat, () => this.work(chat).then(() => this.index(chat))).finally(() => this.done(chat));
  }

  private async hold(chat: string, work: () => Promise<unknown>) {
    const lease = this.session.store.retainChat(chat);
    try {
      const failure = await lease.ready;
      if (failure) return this.change(chat, { failed: { kind: 'unsaved', failure } });
      if (!this.closed) await work();
    } catch (error) {
      const failure = evaluationFailure(error);
      if (failure.error !== 'stopped') this.change(chat, { failed: { kind: 'unsaved', failure } });
    } finally { lease.release(); }
  }

  private done(chat: string) {
    const next = this.schedule.finish(chat);
    this.change(chat, { running: null });
    if (next) this.start(chat, next);
  }

  private async work(chat: string) {
    while (!this.closed) {
      this.schedule.planning(chat);
      const planned = await this.plan(chat);
      if (!planned) return;
      if ('kind' in planned) return this.change(chat, { failed: planned });
      this.change(chat, { running: { model: entryName(planned.route.model), left: planned.left } });
      const outcome = await this.summarize(chat, planned);
      if (outcome === 'stopped') return;
      if (typeof outcome === 'string') continue;
      if (!planned.job.chapter) return this.change(chat, { failed: outcome });
      this.unchapter(chat, planned.job.chapter, outcome);
    }
  }

  // Retrieval's vectors follow the records (runtime/retrieval): embedded once the summarizing pass is done. A failure
  // here stops nothing else, and waits for the next chat open or 다시 시도.
  private async index(chat: string) {
    const missing = unembedded(this.session.store, chat);
    if (!missing || (!missing.records.length && !missing.stale) || this.state.indexFailed.has(chat)) return;
    const total = missing.records.length;
    this.change(chat, { indexing: { done: 0, total } });
    const control = new AbortController();
    this.aborts.add(control);
    try {
      const done = await indexRecords(this.session, chat, control.signal, (embedded) => this.change(chat, { indexing: { done: embedded, total } }));
      this.change(chat, { indexing: null, indexFailed: done.ok ? null : 'failure' in done ? { kind: 'unsaved', failure: done.failure } : { kind: 'embed', reason: done.reason, receipt: done.receipt } });
    } catch (error) {
      const failure = evaluationFailure(error);
      this.change(chat, { indexing: null, indexFailed: failure.error === 'stopped' ? null : { kind: 'unsaved', failure } });
    } finally { this.aborts.delete(control); }
  }

  // A chapter is optional: its failure stops no record from being made.
  private unchapter(chat: string, records: string[], failure: MemoryFailure) {
    this.unchaptered.set(chat, new Set([...(this.unchaptered.get(chat) ?? []), ...records]));
    this.change(chat, { chapterFailed: failure });
  }

  // Priority: explicit request → stale automatic record → new messages → chapter.
  // Rebuild stale chapter members first; deleted-message records and chapter rebuilds require user action.
  private async plan(chat: string): Promise<Planned | MemoryFailure | null> {
    const { store } = this.session;
    const memory = chatMemory(store, chat);
    const sent = await chatSent(this.session, chat, 'memory', memory);
    if (!sent || 'kind' in sent) return sent;
    const owner = memoryOwner(store, sent.chat);
    if (owner?.kind !== 'built-in') return null;
    const { setup } = owner;
    const held = sent.standing!;
    const places = placesOf(sent.read.shown);
    const asked = [...memory.records, ...memory.chapters].find(({ id }) => id === this.schedule.requested(chat));
    const stale = memory.records.filter((record) => !owned(record) && !record.forgotten && staleness(record, sent.read, places) === 'changed');
    const member = asked && isChapter(asked) ? stale.find(({ id }) => asked.records.some((each) => each.id === id)) : undefined;
    if (!member) this.schedule.rebuild(chat, null);
    // Without a 장기 기억 slot in the request, a new record would only take its messages out of it, and a stale one
    // summarized again would be paid for and never read. What the user asked for is made whatever the prompt holds.
    let slot: boolean | null = null;
    const reaches = async () => (slot ??= (await wouldSend(this.session, chat, { kind: 'answer' }, undefined, 'memory'))?.prompt.memory?.slot === true);
    const again = member ?? asked ?? (stale.length && await reaches() ? stale[0] : undefined);
    const span = !again && this.schedule.includesNew(chat) && await reaches() ? await this.span(chat, sent.tokens, coveredBy(memory, places), setup) : null;
    const tools = memoryWriter(this.session.store, sent.chat);
    let chapters: ReturnType<typeof nextChapters> = [];
    if (!('kind' in tools) && !again && !span && this.schedule.includesNew(chat) && await reaches()) {
      const snapshot = await this.session.tokens.snapshot(tools.route, tools.settings, tokenLimits(tools.route.model, sentSettings(store, tools.route)), 'memory', chat, new AbortController().signal);
      if (!snapshot.ok) return { kind: 'unsaved', failure: snapshot };
      const cap = chapterCap(setup.batch, snapshot.data.fit.allowance);
      chapters = nextChapters(memory, held, sent.read.shown, sent.tokens, setup.budget, cap, this.unchaptered.get(chat) ?? new Set());
    }
    const next = chapters[0];
    if (!again && !span && !next) return null;
    if ('kind' in tools) return tools;
    const indices = again ? again.sources.flatMap(({ message }) => places.get(message) ?? []) : [];
    if (again && !indices.length) return null;
    const [from, to] = again ? [Math.min(...indices), Math.max(...indices) + 1] : span ? [span.from, span.to] : [next!.from, next!.to];
    const chapter = again && isChapter(again) ? members(memory, again) : again ? null : (next?.records ?? null);
    if (chapter?.length === 0) return null;
    const job: Job = { sources: sent.read.shown.slice(from, to), redo: again ? { id: again.id, at: again.at, user: again === asked } : null, chapter };
    const order = new Map(memory.records.map(({ id }, index) => [id, index]));
    const first = chapter ? order.get(chapter[0]!)! : again ? memory.records.indexOf(again as MemoryRecord) : memory.records.length;
    const before = chapter
      ? (memory.chapters.filter((each) => each !== again && order.get(each.records[0]!.id)! < first).findLast((each) => !each.forgotten) ?? null)
      : (memory.records.slice(0, first).findLast((record) => !record.forgotten) ?? null);
    const target = next ? next.target : chapter && chapterTarget(chapter.map((id) => held.costs.get(id)!));
    const waiting = span ? Math.ceil(span.waiting / setup.batch) : 0;
    return { job, sent, from, to, memory, before, chapter: target === null ? null : { target }, ...tools, left: Math.max(stale.length + waiting + chapters.length, 1) };
  }

  // Earlier than batch when the next request drops messages for want of room.
  private async span(chat: string, tokens: number[], covered: number, setup: MemorySettings) {
    const { end, waiting } = rawParts(tokens, covered, setup.window);
    if (end === covered) return null;
    const dropped = waiting < setup.batch ? ((await wouldSend(this.session, chat, { kind: 'answer' }, undefined, 'memory'))?.prompt.dropped ?? 0) : 0;
    const span = nextSpan(tokens, covered, setup, dropped);
    return span && { ...span, waiting };
  }

  private async summarize(chat: string, { job, sent, from, to, memory, before, chapter, prompt, route, settings }: Planned): Promise<Outcome> {
    const { store, credentials, log } = this.session;
    const budget = memoryBudget(memorySetup(store, sent.chat).budget, promptBudget(store, sent.chat));
    const assembled = await store.evaluation.memory({ asker: 'memory', chat }, { scope: sent.scope, prompt, memory, before, budget, span: { from, to }, chapter, seed: crypto.randomUUID() });
    if ('kind' in assembled) return assembled;
    const { messages, span } = assembled;
    const read = span.map((each, offset) => ({ role: sent.read.roles[from + offset]!, text: each }));
    const target: CallTarget = { id: crypto.randomUUID(), chat, result: crypto.randomUUID(), for: { kind: 'memory', sources: job.sources, print: fingerprint(read), ...(job.chapter && { chapter: job.chapter }) } };
    const text = gather();
    const answer = await this.reads(target.id, async (signal) =>
      generate({ credentials, log, connection: route.connection.value, model: route.model, settings, retries: retriesOf(store, route.connection.value, settings), messages, call: await newCall(this.session, route, target), signal, onText: text.add }),
    );
    return this.finish(chat, target.id, target.result, callOf(route), answer, text.value(), job, read);
  }

  // Validate resumed answers against the marker's call-time rendered print. Drop them if current rendering differs:
  // validating against unseen text would both mischeck quotes and falsely mark the new records fresh.
  private async resumed(chat: string, stream: Stored<'stream'>, { sources, print, chapter }: Extract<Stream['for'], { kind: 'memory' }>) {
    const text = gather();
    const answer = await this.reads(stream.id, (signal) => resume(this.session, stream, signal, text.add));
    const sent = await chatSent(this.session, chat, 'memory', null);
    if (sent && 'kind' in sent) return this.change(chat, { failed: sent });
    const places = placesOf(sent?.read.shown ?? []);
    const indices = sources.flatMap(({ message }) => places.get(message) ?? []);
    const read = indices.map((index) => ({ role: sent!.read.roles[index]!, text: sent!.read.texts[index]! }));
    if (indices.length < sources.length || fingerprint(read) !== print) {
      if (answer.cut !== 'stopped') endCall(this.session.store, stream.id);
      return;
    }
    const memory = chatMemory(this.session.store, chat);
    const again = chapter
      ? memory.chapters.find((each) => members(memory, each).join(' ') === chapter.join(' '))
      : memory.records.find((record) => {
          const present = record.sources.filter(({ message }) => places.has(message));
          return present.length === sources.length && present.every(({ message }, index) => message === sources[index]!.message);
        });
    const job: Job = { sources, redo: again ? { id: again.id, at: again.at, user: false } : null, chapter: chapter ?? null };
    const outcome = await this.finish(chat, stream.id, stream.value.result, stream.value.call, answer, text.value(), job, read);
    if (typeof outcome === 'string') return;
    if (chapter) this.unchapter(chat, chapter, outcome);
    else this.change(chat, { failed: outcome });
  }

  private async reads(id: string, call: (signal: AbortSignal) => Promise<Reply>): Promise<Reply> {
    const abort = new AbortController();
    this.aborts.add(abort);
    this.reading.add(id);
    try {
      return await call(abort.signal);
    } finally {
      this.reading.delete(id);
      this.aborts.delete(abort);
    }
  }

  // The commit's check runs inside the update, so a version conflict pulls and checks again against the newer memory.
  private async finish(chat: string, id: string, first: string, call: Parameters<typeof receiptOf>[0], answer: Reply, text: string, job: Job, span: { role: string; text: string }[]): Promise<Outcome> {
    if (answer.cut === 'stopped') return 'stopped';
    const { store } = this.session;
    const receipt = unsettled(receiptOf(call, answer));
    const outcome = await (async (): Promise<Outcome> => {
      if (answer.state !== 'done') return { kind: 'failed', receipt };
      const texts = span.map(({ text }) => text);
      const parsed = job.chapter ? parseChapter(text, texts) : parseRecords(text, texts);
      if (!parsed.ok) return { kind: 'invalid', receipt, reason: parsed.reason };
      const saved = await changeMemory(store, chat, (memory) => {
        if (!applies(memory, fold(store.children('entry', chat)), job)) return null;
        return 'chapter' in parsed ? withChapter(memory, job, job.chapter!, parsed.chapter, span, receipt, first) : committed(memory, job, parsed.records, span, receipt, first);
      });
      if (saved.ok) await keepRow(store, receipt, Date.now(), chatPlace(store, chat));
      return saved.ok ? 'done' : saved.error === 'gone' ? 'moved' : { kind: 'unsaved', failure: saved };
    })();
    endCall(store, id);
    this.ended.add(id);
    return outcome;
  }
}

const sameText = (text: string) => text.replace(/\s+/g, ' ').trim();
// Asked for a label, a model writes "T-6f7734a1: <the thread>" or the thread's text alone (measured 2026-10-09, Gemini
// 3.8 Flash); matched on the label alone, no thread ever closed.
const closesThread = (closes: string[], thread: Thread) => closes.some((text) => text.includes(threadLabel(thread)) || sameText(text) === sameText(thread.text));

