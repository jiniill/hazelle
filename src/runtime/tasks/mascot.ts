import { refOf } from '../../connectors/assignment';
import { parseRemark, type RemarkInvalid } from '../../engine/mascot';
import type { RanAway } from '../../engine/pipeline';
import { fold, shown, type Chat, type Message, type Receipt } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import { live } from '../../model/library';
import { MASCOT, type Remark } from '../../model/mascot';
import type { ApiFailure } from '../api';
import { accountTaskModel, type RouteFailure } from '../models/assignment';
import { pinned, scopeOf } from '../chat/chat-context';
import { evaluatingTask } from '../evaluation/evaluation';
import { taskWriter } from '../models/profiles';
import { mascotPrompt } from '../library/prompts';
import type { Session } from '../session';
import { KeyedSnapshot } from '../store/snapshot';
import type { ObjectStore } from '../store/store';
import { pageAnswer } from '../models/streams';
import { chatPlace, receiptRow } from '../models/usage';

// 마스코트 대사 (design §6.11): one 보조 call per reply version writes the mascot's line and face. The only writer of
// `remark` objects but a backup's restore and a chat's copies.

// invalid: the model answered, but with no line the format reads. gone: the message or its version was deleted.
export type MascotFailure =
  | RouteFailure
  | { kind: 'prompt-missing' }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | RanAway
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt; reason: RemarkInvalid }
  | { kind: 'gone' }
  | { kind: 'unsaved'; failure: ApiFailure };

// By version: failure null while its line is written, else why the last try wrote none, kept for the session.
type Comment = { chat: string; message: string; failure: MascotFailure | null };
export type Commenting = ReadonlyMap<string, Comment>;

type Stopped = { kind: 'stopped' };
type Deps = Pick<Session, 'tokens' | 'store' | 'credentials' | 'log'>;

// How many of the mascot's earlier lines its sheet shows, so it does not repeat itself.
const SAID = 3;

// The lines of the versions shown before the reply, oldest first.
function saidBefore(remarks: readonly Stored<'remark'>[], before: readonly Message[]): string[] {
  const byVersion = new Map(remarks.map(({ value }) => [value.version, value.line]));
  return before.flatMap((message) => byVersion.get(shown(message).id) ?? []).slice(-SAID);
}

// Who writes a chat's line: 마스코트's own model, else the chat's 보조 모델, else its 대화 모델.
export const mascotWriterOf = (store: Pick<ObjectStore, 'get'>, chat: Chat) => taskWriter(store, chat, accountTaskModel(store, 'mascot'));

// Several versions are written at once, each going on when its chat is left. A failure is never tried again on its own.
export class Commentator {
  private closed = false;
  private readonly state = new KeyedSnapshot<Comment>();
  private readonly aborts = new Map<string, AbortController>();

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.state.subscribe;

  readonly snapshot = this.state.snapshot;

  comment(chat: string, message: string, version: string) {
    if (this.closed || this.aborts.has(version)) return;
    const abort = new AbortController();
    this.aborts.set(version, abort);
    this.state.put(version, { chat, message, failure: null });
    const lease = this.deps.store.retainChat(chat);
    void lease.ready
      .then(async (failure) => (failure ? { kind: 'unsaved' as const, failure } : this.run(chat, message, version, abort.signal)))
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

  private async run(chat: string, message: string, version: string, signal: AbortSignal): Promise<MascotFailure | Stopped | null> {
    const { store } = this.deps;
    const stored = live(store.get('chat', chat));
    const messages = fold(store.children('entry', chat));
    const index = messages.findIndex(({ id }) => id === message);
    const selected = messages[index]?.versions.findIndex(({ id }) => id === version) ?? -1;
    if (!stored || selected === -1) return { kind: 'gone' };
    const prompt = mascotPrompt(store);
    if (prompt.kind === 'missing') return { kind: 'prompt-missing' };
    const writer = mascotWriterOf(store, stored.value);
    if ('kind' in writer) return writer;
    const { route } = writer;
    const history = [...messages.slice(0, index), { ...messages[index]!, selected }];
    const said = saidBefore(store.children('remark', chat), messages.slice(0, index));
    const scope = scopeOf({ store }, chat, stored.value, history);
    const input = { scope, take: pinned({ store }, stored.value), prompt: prompt.prompt.value, index, mascot: MASCOT, said, seed: crypto.randomUUID() };
    const assembled = await evaluatingTask(store.evaluation.mascot({ asker: 'mascot', chat }, input, signal));
    if ('kind' in assembled) return assembled;
    const answer = await pageAnswer(this.deps, writer, 'mascot', chat, assembled.messages, signal);
    if ('kind' in answer) return answer;
    const { receipt } = answer;
    const parsed = parseRemark(answer.text, MASCOT);
    if (!parsed.ok) return { kind: 'invalid', receipt, reason: parsed.reason };
    const remark: Remark = { message, version, mascot: MASCOT, expression: parsed.expression, line: parsed.line, receipt, model: refOf(route.connection.id, route.model), at: Date.now() };
    // One line per version (model/mascot Remark): the new one replaces any written before it.
    const older = store.children('remark', chat).filter(({ value }) => value.version === version);
    const saved = await store.batch([
      ...older.map(({ id }) => ({ type: 'remove' as const, id })),
      { type: 'create', kind: 'remark', id: crypto.randomUUID(), parent: chat, value: remark },
      receiptRow(receipt, remark.at, chatPlace(store, chat)),
    ]);
    return saved.ok ? null : { kind: 'unsaved', failure: saved };
  }
}
