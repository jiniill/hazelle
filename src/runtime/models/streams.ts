import { unavailableCalibration } from '../../model/token-calibration';
import { tokenLimits, sentSettings } from '../chat/chat-context';
import type { Session } from '../session';
import type { RequestClass } from '../../model/token-calibration';
import { measureInput } from './token-calibration';
import { live } from '../../model/library';
import type { Stored } from '../../model/kinds';
import type { Receipt } from '../../model/chat';
import type { Stream } from '../../model/stream';
import type { PageClass } from '../../model/usage';
import { streamKey } from '../../vault/streams';
import type { Route } from './assignment';
import { chatMemory } from '../tasks/memory-read';
import { gather, generate, receiptOf, unsettled, type Caller, type GenerateInput } from './generate';
import { routeFields } from './connections';
import type { Writer } from './profiles';
import { detachedReplies, dropStream } from './relay';
import type { ObjectStore } from '../store/store';

// The only writer of `stream` objects, each the marker of a generation call the server is making for a chat
// (tech-spec §6, Detached replies).

export const callOf = ({ connection, model }: Route): Stream['call'] => ({ connection: connection.id, source: connection.value.label, model: model.id, modelName: model.name, ...(model.entry !== undefined && { entry: model.entry }) });

// chat: null for a chat not saved yet, whose call a reload does not pick up.
export type CallTarget = { id: string; chat: string | null; result: string; for: Stream['for'] };

// Write markers only after server acceptance, or pickup can save not-yet-started calls as missing.
// Failed markers leave ownership here; late markers after result save are removed by the next pickup.
export async function newCall({ store, tokens }: Pick<Session, 'store' | 'tokens'>, route: Route, { id, chat, result, for: purpose }: CallTarget): Promise<GenerateInput['call']> {
  const key = await streamKey();
  const at = Date.now();
  const requestClass = purpose.kind === 'reply' ? 'conversation' : purpose.kind === 'input' || purpose.kind === 'note' ? 'translation' : purpose.kind;
  const call: GenerateInput['call'] = { id, key: key.private, public: key.public, logged: { chat, purpose: purpose.kind, call: callOf(route) }, ...calibrate({ store, tokens }, route, requestClass, chat) };
  call.started = !detachedReplies() || chat === null ? undefined : (batch?: string) => void store.create('stream', { ...(batch === undefined ? { key: key.private } : { batch }), call: callOf(route), calibration: call.calibration!, at, result, for: purpose }, { id, parent: chat });
  return call;
}

// A call no marker keeps, which only this page reads: a bot's Lua asking a model in the middle of a run, which a
// reload has no use for (bot: its chat, where the server limits these), or a task's through pageAnswer.
export async function pageCall(session: Pick<Session, 'store' | 'tokens'>, route: Route, requestClass: PageClass, chat: string | null): Promise<GenerateInput['call']> {
  const key = await streamKey();
  return { id: crypto.randomUUID(), key: key.private, public: key.public, logged: { chat, purpose: requestClass, call: callOf(route) }, ...calibrate(session, route, requestClass, chat), ...(requestClass === 'script' && chat !== null && { bot: chat }) };
}

// A call no marker keeps (pageCall, or newCall for no chat): no pick-up ever ends it, so however it went, it is ended
// here.
export const generateOnce = ({ store, credentials, log }: Caller, { route, settings }: Writer, asked: Pick<GenerateInput, 'messages' | 'tools' | 'call' | 'signal' | 'onText'>) =>
  generate({ credentials, log, ...routeFields(store, route, settings), ...asked }).finally(() => endCall(store, asked.call.id));

export async function taskCall(caller: Caller, writer: Writer, asked: Parameters<typeof generateOnce>[2]) {
  const answer = await generateOnce(caller, writer, asked);
  return { answer, receipt: unsettled(receiptOf(callOf(writer.route), answer)) };
}

// Auxiliary calls use detached transport without markers: another device must not rerun their task and bill twice.
// Caller owns parsing and completion (illustration/likeness/mascot).
export async function pageAnswer(session: Caller & Pick<Session, 'tokens'>, writer: Writer, requestClass: Exclude<PageClass, 'script'>, chat: string | null, messages: GenerateInput['messages'], signal: AbortSignal, retrying?: () => void): Promise<{ kind: 'stopped' } | { kind: 'failed'; receipt: Receipt } | { text: string; receipt: Receipt }> {
  const text = gather();
  const call = await pageCall(session, writer.route, requestClass, chat);
  call.retrying = retrying;
  const { answer, receipt } = await taskCall(session, writer, { messages, call, signal, onText: text });
  if (answer.cut === 'stopped') return { kind: 'stopped' };
  return answer.state === 'done' ? { text: text.value(), receipt } : { kind: 'failed', receipt };
}

// Auxiliary prompts stay caller-owned: no splitting, trimming, or shrink-and-retry after a provider refusal.
function calibrate({ store, tokens }: Pick<Session, 'store' | 'tokens'>, route: Route, requestClass: RequestClass, chat: string | null): Pick<GenerateInput['call'], 'calibration' | 'measure' | 'preflight'> {
  return {
    calibration: unavailableCalibration('preparation'),
    measure: (prepared) => measureInput(store, route.connection.id, requestClass, prepared),
    ...(requestClass !== 'conversation' && { preflight: async (settings, signal) => {
      const snapshot = await tokens.snapshot(route, settings, tokenLimits(route.model, sentSettings(store, route)), requestClass, chat, signal);
      return snapshot.ok ? { ok: true, data: snapshot.data.fit } : snapshot;
    } }),
  };
}

// A batch's marker names no server object to drop.
export function endCall(store: ObjectStore, id: string) {
  const marker = store.get('stream', id);
  if (!marker || !('batch' in marker.value)) dropStream(id);
  if (marker) void store.remove(id);
}

// Pick up only unread calls on session open or marker/entry changes.
// Result saves also unblock calls waiting for their chat's current turn.
export class Streams {
  private closed = false;
  private readonly checking = new Set<string>();
  private readonly stop: () => void;

  constructor(
    private readonly store: ObjectStore,
    readonly reading: Set<string>,
    private readonly take: (stream: Stored<'stream'>) => void,
  ) {
    this.stop = store.subscribe((changes) => {
      if (changes.some((change) => change.kind === 'stream' || change.kind === 'entry')) this.pickUp();
    });
  }

  pickUp() {
    if (this.closed || !detachedReplies()) return;
    for (const stream of this.store.list('stream')) {
      // A deleted chat's calls stay untaken: they go with its purge, or after its 되돌리기 the next pick-up takes them.
      if (this.reading.has(stream.id) || this.checking.has(stream.id) || !live(this.store.get('chat', stream.parent!))) continue;
      this.checking.add(stream.id);
      void this.store.withChat(stream.parent!, async () => {
        if (!this.closed && !this.reading.has(stream.id)) {
          if (this.saved(stream)) endCall(this.store, stream.id);
          else this.take(stream);
        }
        return { ok: true, data: null };
      }).finally(() => this.checking.delete(stream.id));
    }
  }

  close() {
    this.closed = true;
    this.stop();
  }

  // A memory summary's result is not an entry: its first record, or its chapter, takes the result's id.
  private saved({ parent, value: { result, for: purpose } }: Stored<'stream'>): boolean {
    if (purpose.kind !== 'memory') return this.store.children('entry', parent!).some((entry) => entry.id === result);
    const { records, chapters } = chatMemory(this.store, parent!);
    return [...records, ...chapters].some(({ id }) => id === result);
  }
}
