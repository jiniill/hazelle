import { ChangeSignal } from '../change-signal';
import { fold, type ChatSummary, type Message } from '../model/chat';
import { findInMessages, litIn, type Lit, type MessageHit } from '../model/search';
import type { ApiFailure, ApiResult } from './api';
import type { Library } from './read-model';
import type { ObjectStore, Pin } from './store';

// As many as the codec pool has workers, so a chat opened meanwhile waits behind few of these.
const AT_ONCE = 4;
// Hits pile in at most this often, so thousands of chats read do not draw the list thousands of times.
const TELL_MS = 100;

// order: the chat's when it was read, so a chat written to since is read again.
type Read = { order: number; hit: MessageHit | null } | { order: number; unreadable: true };
// term: folded (model/search foldTerm). read holds what the scan found in page memory only, never stored. filling: how
// far the chats not on this device yet have come down (ObjectStore.fillChats), null outside that step.
export type Finding = { term: string; read: ReadonlyMap<string, Read>; running: boolean; filling: number | null; failure: ApiFailure | null };

// Only live chats of live characters and 캐릭터 없이: a binned character's chats go and come back with it.
export const liveChats = (library: Library): ChatSummary[] => [...library.characters.flatMap((shelf) => shelf.chats), ...library.none.chats];

// 채팅 검색's pass over every chat's messages: a few chats at a time, each let go once read, so no more than those few
// are in memory.
export class ChatFinder {
  private finding: Finding = { term: '', read: new Map(), running: false, filling: null, failure: null };
  private reading = new Map<string, Read>();
  private run: AbortController | null = null;
  private telling: ReturnType<typeof setTimeout> | null = null;
  private readonly changes = new ChangeSignal();

  constructor(private readonly store: ObjectStore) {}

  readonly subscribe = this.changes.subscribe;
  readonly snapshot = () => this.finding;

  // The same term again reads only the chats not read for it yet or written to since; another term starts over.
  find(term: string, chats: readonly ChatSummary[]) {
    this.stop();
    if (term !== this.finding.term) this.reading = new Map();
    const due = term ? chats.filter((chat) => this.reading.get(chat.id)?.order !== chat.order).sort((a, b) => b.order - a.order) : [];
    this.tell({ term, running: due.length > 0, failure: null });
    if (!due.length) return;
    const run = new AbortController();
    this.run = run;
    void this.scan(term, due, run.signal);
  }

  // What was read stays, for the same term to go on from.
  stop() {
    this.run?.abort();
    this.run = null;
    if (this.finding.running) this.tell({ running: false, filling: null });
  }

  close() {
    this.stop();
    if (this.telling) clearTimeout(this.telling);
    this.reading = new Map();
    this.changes.clear();
  }

  private async scan(term: string, due: readonly ChatSummary[], signal: AbortSignal) {
    const failure = await this.store.pinned(async (pin) => {
      const filled = await this.store.fillChats(due.map(({ id }) => id), pin, signal, (filling) => this.tell({ filling }));
      if (signal.aborted) return null;
      this.tell({ filling: null });
      if (!filled.ok) return filled;
      let next = 0;
      let failed: ApiFailure | null = null;
      const reader = async () => {
        while (!failed && !signal.aborted && next < due.length) {
          const { id, order } = due[next++]!;
          const messages = await this.messages(id, pin, signal);
          if (signal.aborted) return;
          if (messages.ok) this.reading.set(id, { order, hit: findInMessages(messages.data, term) });
          else if (messages.error === 'unreadable') this.reading.set(id, { order, unreadable: true });
          else failed = messages;
          this.soon();
        }
      };
      await Promise.all(Array.from({ length: AT_ONCE }, reader));
      return failed;
    }, signal);
    if (!signal.aborted) this.tell({ running: false, failure });
  }

  // A held chat is read as it is shown, its writes not yet confirmed included.
  private async messages(chat: string, pin: Pin, signal: AbortSignal): Promise<ApiResult<Message[]>> {
    if (this.store.scopeState(chat) === 'loaded') return { ok: true, data: this.store.foldedChat(chat).messages };
    const entries = await this.store.chatEntries(chat, pin, signal);
    return entries.ok ? { ok: true, data: fold(entries.data) } : entries;
  }

  private soon() {
    this.telling ??= setTimeout(() => {
      this.telling = null;
      this.tell({});
    }, TELL_MS);
  }

  private tell(change: Partial<Finding>) {
    this.finding = { ...this.finding, ...change, read: new Map(this.reading) };
    this.changes.notify();
  }
}

// title and preview: lit where the summary's own holds the term. hit: where its messages do, once read.
export type Found = { summary: ChatSummary; title: Lit | null; preview: Lit | null; hit: MessageHit | null };
// read: the chats whose messages were read for the term, unreadable among them.
export type Results = { found: Found[]; read: number; unreadable: number };

// Chats whose title or preview holds the term first, then those whose messages alone do; each by latest activity.
export function results(chats: readonly ChatSummary[], term: string, finding: Finding): Results {
  if (!term) return { found: [], read: 0, unreadable: 0 };
  const named: Found[] = [];
  const bodies: Found[] = [];
  let read = 0;
  let unreadable = 0;
  for (const summary of chats) {
    const done = finding.term === term ? finding.read.get(summary.id) : undefined;
    const current = done?.order === summary.order ? done : undefined;
    if (current) read++;
    if (current && 'unreadable' in current) unreadable++;
    const hit = current && 'hit' in current ? current.hit : null;
    const title = litIn(summary.title, term);
    const preview = summary.preview === null ? null : litIn(summary.preview, term);
    if (title || preview) named.push({ summary, title, preview, hit });
    else if (hit) bodies.push({ summary, title, preview, hit });
  }
  const latest = (a: Found, b: Found) => b.summary.order - a.summary.order;
  return { found: [...named.sort(latest), ...bodies.sort(latest)], read, unreadable };
}
