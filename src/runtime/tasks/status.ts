import { parseStatus } from '../../engine/status';
import type { RanAway } from '../../engine/pipeline';
import { fold, statusChanges, type Chat, type Receipt } from '../../model/chat';
import { live } from '../../model/library';
import { statusAfter, type StatusDefinition } from '../../model/status';
import type { ApiFailure } from '../api';
import { scopeOf, statusOf } from '../chat/chat-context';
import { appendStatus, type Written } from '../chat/chat-log';
import { evaluatingTask } from '../evaluation/evaluation';
import { statusPrompt } from '../library/prompts';
import { accountTaskModel, type RouteFailure } from '../models/assignment';
import { taskWriter } from '../models/profiles';
import { pageAnswer } from '../models/streams';
import type { Session } from '../session';
import { KeyedSnapshot } from '../store/snapshot';
import type { ObjectStore } from '../store/store';

// 상태 (design §6.1): who writes a chat's state changes. The conversation model's own block is cut from its reply
// (cutStatus); the definitions written after the reply get one call of their own a version (StatusWriter). These
// two, a hand's edit and a chat's copies are the only writers of `status` entries.

type Reader = Pick<ObjectStore, 'get' | 'children' | 'scopeState'>;

// The chat's definitions the conversation model writes at its reply's end.
function askedWith(store: Reader, chat: string): StatusDefinition[] {
  const stored = live(store.get('chat', chat));
  return stored ? statusOf(store, stored.value).filter(({ writer }) => writer === 'with') : [];
}

// Whether the chat's replies end with a block that is cut: one being written is then shown without it.
export const cutsStatus = (store: Reader, chat: string) => askedWith(store, chat).length > 0;

// The reply as it is handed on to the bot's scripts and the save: its block cut from its text and read against the
// state its model was told. A chat that asks for none keeps its text whole, since a bot may draw a block of its own.
// A reply that did not end whole has its block cut and writes nothing; one that ended with no block to read is kept
// as missed, never guessed. A continuation carries what the version it continues wrote, which its model was told.
export function cutStatus(store: Reader, chat: string, reply: Written): Written {
  const asked = askedWith(store, chat);
  if (!asked.length) return reply;
  const of = asked.map(({ id }) => id);
  const messages = fold(store.children('entry', chat));
  const at = reply.message === null ? -1 : messages.findIndex(({ id }) => id === reply.message);
  const continued = reply.receipt.continues && at !== -1 ? messages[at]!.versions.find(({ id }) => id === reply.replaces) : undefined;
  const carried = (continued?.status ?? []).flatMap(({ changes }) => changes).filter(({ definition }) => of.includes(definition));
  const told = statusAfter(asked, [...statusChanges(at === -1 ? messages : messages.slice(0, at)), ...carried]);
  const read = parseStatus(reply.text, asked, told, () => crypto.randomUUID());
  if (reply.receipt.state !== 'done') return { ...reply, text: read.text };
  return { ...reply, text: read.text, status: { of, changes: [...carried, ...read.changes], receipt: null, at: reply.at, ...(read.unread.length > 0 && { unread: read.unread }), ...(!read.found && { missed: true as const }) } };
}

// invalid: the model answered with no block to read; the version is then kept as missed, with the call's receipt.
// gone: the message or its version was deleted.
export type StatusFailure =
  | RouteFailure
  | { kind: 'prompt-missing' }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | RanAway
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt }
  | { kind: 'gone' }
  | { kind: 'unsaved'; failure: ApiFailure };

// By version: failure null while its state is written, else why the last try wrote none, kept for the session.
type Write = { chat: string; message: string; failure: StatusFailure | null };
export type StatusWriting = ReadonlyMap<string, Write>;

type Stopped = { kind: 'stopped' };
type Deps = Pick<Session, 'tokens' | 'store' | 'credentials' | 'log' | 'costs'>;

// Who writes a chat's state after a reply: 상태's own model, else the chat's 보조 모델, else its 대화 모델.
export const statusWriterOf = (store: Pick<ObjectStore, 'get'>, chat: Chat) => taskWriter(store, chat, accountTaskModel(store, 'status'));

// Several versions are written at once, each going on when its chat is left. A failure is never tried again on its own.
export class StatusWriter {
  private closed = false;
  private readonly state = new KeyedSnapshot<Write>();
  private readonly aborts = new Map<string, AbortController>();

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.state.subscribe;

  readonly snapshot = this.state.snapshot;

  // After a reply: the definitions written after it, and nothing in a chat that declares none. again (상태 다시 쓰기,
  // the user's press): every definition, the ones the reply's own model wrote too, with the reply's text left as it is.
  write(chat: string, message: string, version: string, again = false) {
    if (this.closed || this.aborts.has(version)) return;
    const stored = live(this.deps.store.get('chat', chat));
    if (!stored || !asked(statusOf(this.deps.store, stored.value), again).length) return;
    const abort = new AbortController();
    this.aborts.set(version, abort);
    this.state.put(version, { chat, message, failure: null });
    const lease = this.deps.store.retainChat(chat);
    void lease.ready
      .then(async (failure) => (failure ? { kind: 'unsaved' as const, failure } : this.run(chat, message, version, again, abort.signal)))
      .then(
        (outcome) => this.state.put(version, outcome && outcome.kind !== 'stopped' ? { chat, message, failure: outcome } : null),
        (error: unknown) => {
          this.state.put(version, null);
          throw error;
        },
      )
      .finally(() => {
        this.aborts.delete(version);
        lease.release();
      });
  }

  close() {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
  }

  private async run(chat: string, message: string, version: string, again: boolean, signal: AbortSignal): Promise<StatusFailure | Stopped | null> {
    const { store } = this.deps;
    const stored = live(store.get('chat', chat));
    const messages = fold(store.children('entry', chat));
    const index = messages.findIndex(({ id }) => id === message);
    const selected = messages[index]?.versions.findIndex(({ id }) => id === version) ?? -1;
    if (!stored || selected === -1) return { kind: 'gone' };
    const definitions = statusOf(store, stored.value);
    const writes = asked(definitions, again);
    if (!writes.length) return null;
    const of = writes.map(({ id }) => id);
    const prompt = statusPrompt(store);
    if (prompt.kind === 'missing') return { kind: 'prompt-missing' };
    const writer = statusWriterOf(store, stored.value);
    if ('kind' in writer) return writer;
    // What the reply's other writer left for the definitions not asked here stands; what is asked again is told as it
    // was before the reply.
    const standing = (messages[index]!.versions[selected]!.status ?? []).flatMap(({ changes }) => changes).filter(({ definition }) => !of.includes(definition));
    const told = statusAfter(definitions, [...statusChanges(messages.slice(0, index)), ...standing]);
    const history = [...messages.slice(0, index), { ...messages[index]!, selected }];
    const input = { scope: scopeOf({ store }, chat, stored.value, history), prompt: prompt.prompt.value, index, state: told, asked: of, seed: crypto.randomUUID() };
    const assembled = await evaluatingTask(store.evaluation.status({ asker: again ? 'rewrite' : 'status', chat }, input, signal));
    if ('kind' in assembled) return assembled;
    const answer = await pageAnswer(this.deps, writer, 'status', chat, assembled.messages, signal);
    if ('kind' in answer) return answer;
    const { receipt } = answer;
    const read = parseStatus(answer.text, writes, told, () => crypto.randomUUID());
    const saved = await appendStatus(store, chat, version, { of, changes: read.changes, receipt, at: Date.now(), ...(read.unread.length > 0 && { unread: read.unread }), ...(!read.found && { missed: true as const }) });
    if (!saved.ok) return { kind: 'unsaved', failure: saved };
    this.deps.costs.settle(chat, receipt);
    return read.found ? null : { kind: 'invalid', receipt };
  }
}

const asked = (definitions: readonly StatusDefinition[], again: boolean) => (again ? [...definitions] : definitions.filter(({ writer }) => writer === 'after'));
