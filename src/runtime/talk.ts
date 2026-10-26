import type { Preparing } from './turn-steps';
import type { Tokens } from './token-calibration';
import type { ContextRefusal } from '../connectors/preparation';
import type { InputMeasurement, TokenFit, CallCalibration } from '../model/token-calibration';
import { ChangeSignal } from '../change-signal';
import type { Cues } from './cues';
import type { ModelSettings } from '../connectors/settings';
import type { InlineThoughts } from '../connectors/stream';
import type { Phase } from '../connectors/types';
import type { Assembled } from '../engine/pipeline';
import type { Settle } from './preread';
import type { CacheDiagnosis, CacheForecast, CacheText } from '../model/cache';
import type { AgentRun, Message, Receipt, Writes } from '../model/chat';
import { without } from '../model/fields';
import type { Stored } from '../model/kinds';
import type { Stream } from '../model/stream';
import type { ApiFailure } from './api';
import type { Route, RouteFailure } from './assignment';
import { cacheKept, wireOf, wireTextOf, writePrint } from './cache';
import { appendReply, appendUserMessage, savedElsewhere, type Said, type Written } from './chat-log';
import { retriesOf } from './connections';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { gather, generate, receiptOf, resume, unsettled, type GenerateInput, type Reply } from './generate';
import { stopStream } from './relay';
import type { RequestLog } from './request-log';
import type { ObjectStore } from './store';
import type { ChatLease } from './chat-scope';
import { callOf, endCall, newCall, pageCall, type PageClass } from './streams';
import type { Session } from './session';

// A continuation's text and reasoning start as those it continues. before:
// what the bot's Lua wrote before the reply was made (model/chat Entry).
export type Turn = {
  chat: string;
  said: Said | null;
  // follows: what a new message continues (model/chat Entry).
  reply: { id: string; message: string | null; replaces: string | null; follows?: string | null; continues: { text: string; receipt: Receipt; seed: string; reasoning?: string } | null; before?: Writes };
  text: string;
  reasoning: string;
  // whole: asked for in one piece (ModelSettings streaming), so it is shown when it lands, not paced as bursts are.
  whole?: true;
  // batch: waiting for a discount lane's batch (design §6.7), which answers whole. retrying: a try failed before any of it
  // came and is sent again (retry on failure). stopping: 멈추기 canceled the batch, which is asked about until it ends.
  // preparing: a call the reply waits for runs first, 토큰 절약's (runtime/preread), the pre agents' (runtime/agents), by
  // the names of those still running out of how many run, or a tool's reading the request (ScriptTurns.requesting).
  batch?: true;
  retrying?: true;
  stopping?: true;
  preparing?: Preparing;
};
// unstored: the user's message shown before the store has it. Nothing may be saved against it yet: fold skips, for
// good, an entry that names a message saved after it.
export type Shown = Message & { live: string | null; whole?: true; batch?: true; retrying?: true; stopping?: true; preparing?: Preparing; unstored?: true };

// The prompt, which the reply's id seeds. settings: the model's 설정 묶음 as stored, which the request fits to the model.
// said: the user's message as it is saved, which a message sent translated saves translated; null when prepare saved it
// itself. forecast: what the send expects to read from the cache (runtime/cache), kept on its receipt. preread: makes
// the record of the 토큰 절약 call that shortened the prompt from the reply's receipt, which keeps it. agents: the pre
// agents' calls, which the receipt keeps.
export type Ask = { diagnose?: (prompt: Assembled, wire: CacheText) => Promise<CacheDiagnosis | null>; calibration?: Pick<CallCalibration, 'fit' | 'retries'>; refit?: (refusal: ContextRefusal, measurement: InputMeasurement) => Promise<{ prompt: Assembled; fit: TokenFit; retries: CallCalibration['retries'] } | null>; route: Route; settings: ModelSettings; prompt: Assembled; said: Said | null; before?: Writes; forecast?: CacheForecast; preread?: Settle; agents?: AgentRun[] };

// unsent: the user's message was not saved, so its reply was stopped. unsaved: the reply was written
// but not saved; saveAgain(reply) tries it again. reply null: a restore ended the turn, and nothing is kept to save.
export type TalkFailure = RouteFailure | { kind: 'unsent'; failure: ApiFailure } | { kind: 'unsaved'; reply: string | null; failure: ApiFailure };

const saidMessages = new WeakMap<Said, Shown>();
const rested = new WeakMap<Message, Shown>();
const resting = (message: Message): Shown => {
  if ('live' in message) return message as Shown;
  let held = rested.get(message);
  if (!held) { held = { ...message, live: null }; rested.set(message, held); }
  return held;
};

export function withTurn(messages: Message[], turn: Turn | null, chat: string): Shown[] {
  const out = messages.map((message) => resting(message));
  if (turn?.chat !== chat) return out;
  const { said, reply } = turn;
  const now = Date.now();
  if (said && !out.some((message) => message.id === said.id)) {
    let message = saidMessages.get(said);
    if (!message) {
      message = { id: said.id, role: 'user', at: now, versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: now, ...(said.translation && { translation: said.translation }), ...(said.before && { before: said.before }) }], selected: 0, live: null, unstored: true };
      saidMessages.set(said, message);
    }
    out.push(message);
  }
  const version = { id: reply.id, seed: reply.continues?.seed ?? reply.id, text: turn.text, receipt: null, edited: false, at: now, ...(reply.before && { before: reply.before }), ...(turn.reasoning && { reasoning: turn.reasoning }) };
  const live = { live: reply.id, ...(turn.whole && { whole: true as const }), ...(turn.batch && { batch: true as const }), ...(turn.retrying && { retrying: true as const }), ...(turn.stopping && { stopping: true as const }), ...(turn.preparing && { preparing: turn.preparing }) };
  // A reply saved while its turn is held stays live until the turn ends, so nothing between its save and Talk's end
  // shows it settled (Translator.expect).
  const saved = out.findIndex((message) => message.id === (reply.message ?? reply.id) && message.versions.some((existing) => existing.id === reply.id));
  if (saved !== -1) {
    out[saved] = { ...out[saved]!, ...live };
    return out;
  }
  if (reply.message === null) {
    out.push({ id: reply.id, role: 'assistant', at: now, versions: [version], selected: 0, ...live });
    return out;
  }
  const index = out.findIndex((message) => message.id === reply.message);
  const message = out[index];
  if (!message) return out;
  const slot = reply.replaces === null ? -1 : message.versions.findIndex((existing) => existing.id === reply.replaces);
  const versions = slot === -1 ? [...message.versions, version] : message.versions.with(slot, version);
  out[index] = { ...message, versions, selected: slot === -1 ? versions.length - 1 : slot, ...live };
  // A new version continues nothing yet; one in another's place keeps what continues it.
  return slot === -1 ? out.slice(0, index + 1) : out;
}

// preparing: shows a call the reply waits for running, until the prompt is ready.
type Prepare<F> = (signal: AbortSignal, preparing: (step: Preparing) => void) => Promise<Ask | F>;

// abort: stops the turn's reading. cancel: 멈추기, which cancels a batch, still read until it ends (GenerateInput batching).
type Held = { turn: Turn; abort: AbortController; cancel: AbortController; calling: string | null };

// A reply blocks only its own chat: chats, in one tab or several, reply at once (user, 2026-10-04). A reply outlives
// the screen that asked for it: leaving a chat does not stop it. For an account the server makes the call, so
// close() only stops reading it; a guest's transport aborts the provider instead and leaves no marker to pick up.
export class Talk {
  // By chat. calling: the call the turn reads, once it started.
  private readonly turns = new Map<string, Held>();
  // Replaced only when a turn starts or ends, never per chunk, so the sidebars that read it do not render per token.
  private writingChats: ReadonlySet<string> = new Set();
  private closed = false;
  private readonly unsaved = new Map<string, { chat: string; reply: Written; call: string }>();
  private readonly changes = new ChangeSignal();
  private readonly leave: () => void;

  constructor(
    private readonly store: ObjectStore,
    private readonly credentials: Credentials,
    private readonly log: RequestLog,
    private readonly costs: Costs,
    private readonly tokens: Tokens,
    // ended: a reply as its stream ended, which the bot's Lua may rewrite before it is saved. saved: once it is.
    private readonly ended: (chat: string, reply: Written) => Promise<Written>,
    private readonly saved: (chat: string, reply: Written) => void,
    // The calls this page reads (runtime/streams).
    private readonly reading: Set<string>,
    private readonly cues: Cues,
  ) {
    // A restore ends the store a turn was begun on, and none of the turn's writes can land after it, so it ends every
    // turn as 멈추기 does, a batch's wait too: a call left running would be billed and never read. close does not: a
    // call outlives a locked vault, for the next session to read.
    this.leave = store.subscribeRewound(() => {
      for (const held of this.turns.values()) {
        this.halt(held);
        held.abort.abort();
      }
    });
  }

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = (chat: string): Turn | null => this.turns.get(chat)?.turn ?? null;

  readonly writing = (): ReadonlySet<string> => this.writingChats;

  // 멈추기: the call ends on the server too, and the text so far is saved as cut; a batch is canceled at the provider and
  // waited for until it ends. Reading stops first, so the server's end is never read as the stream's own.
  stop(chat: string) {
    const held = this.turns.get(chat);
    if (held) this.halt(held);
  }

  private halt(held: Held) {
    held.cancel.abort();
    if (held.turn.batch) return this.change(held, { ...held.turn, stopping: true });
    held.abort.abort();
    if (held.calling) stopStream(held.calling);
  }

  close() {
    this.closed = true;
    for (const held of this.turns.values()) held.abort.abort();
    this.unsaved.clear();
    this.leave();
  }

  async saveAgain(reply: string): Promise<TalkFailure | null> {
    const unsaved = this.unsaved.get(reply);
    if (!unsaved) return null;
    const lease = this.store.retainChat(unsaved.chat);
    try {
      const failure = await lease.ready;
      return failure ? { kind: 'unsaved', reply, failure } : await this.save(unsaved.chat, unsaved.reply, unsaved.call);
    } finally { lease.release(); }
  }

  // A reply not saved keeps its call's marker, so a reload saves it too.
  private async save(chat: string, reply: Written, call: string): Promise<TalkFailure | null> {
    const appended = await appendReply(this.store, chat, reply);
    const elsewhere = !appended.ok && savedElsewhere(this.store, chat, reply.id, appended);
    if (!appended.ok && !elsewhere) {
      // Saved again, it would land on the chat the restore rewound, which the reply was never written against.
      if (appended.error === 'timeline-changed') {
        endCall(this.store, call);
        return { kind: 'unsaved', reply: null, failure: appended };
      }
      this.unsaved.set(reply.id, { chat, reply, call });
      return { kind: 'unsaved', reply: reply.id, failure: appended };
    }
    this.unsaved.delete(reply.id);
    endCall(this.store, call);
    if (elsewhere) return null;
    this.costs.settle(chat, reply.receipt);
    this.saved(chat, reply);
    return null;
  }

  private seat(chat: string, said: Turn['said'], reply: Turn['reply']): Held {
    const turn = { chat, said, reply, text: reply.continues?.text ?? '', reasoning: reply.continues?.reasoning ?? '' };
    const held: Held = { turn, abort: new AbortController(), cancel: new AbortController(), calling: null };
    this.turns.set(chat, held);
    this.writingChats = new Set(this.turns.keys());
    this.changes.notify();
    return held;
  }

  // In a finally, so on a throw too: a turn left seated turns every later send of its chat away.
  private unseat(held: Held) {
    held.abort.abort();
    if (held.calling) this.reading.delete(held.calling);
    this.turns.delete(held.turn.chat);
    this.writingChats = new Set(this.turns.keys());
    this.changes.notify();
  }

  private change(held: Held, turn: Turn) {
    held.turn = turn;
    this.changes.notify();
  }

  // The turn is shown before prepare, which may save a new chat, translate the user's message and builds the prompt,
  // so the user's message appears the moment it is sent; stop() stops prepare too. A failure prepare returns ends the
  // turn unsent.
  async run<F extends { kind: string }>({ chat, said, reply: asked }: Omit<Turn, 'text' | 'reasoning'>, prepare: Prepare<F>): Promise<TalkFailure | F | null> {
    if (this.turns.has(chat)) return null;
    const lease = this.store.retainChat(chat);
    const held = this.seat(chat, said, asked);
    try {
      // A turn is one workflow: begun on one timeline, none of its writes lands on the next (store pinned).
      const ran = await this.store.pinned(() => this.turnOn(held, said, asked, lease, prepare));
      return ran !== null && 'ok' in ran ? { kind: 'unsent', failure: ran } : ran;
    } finally {
      this.unseat(held);
      lease.release();
    }
  }

  private async turnOn<F extends { kind: string }>(held: Held, said: Turn['said'], asked: Turn['reply'], lease: ChatLease, prepare: Prepare<F>): Promise<TalkFailure | F | null> {
    const { chat } = held.turn;
    const { abort } = held;
    const failure = await lease.ready;
    if (failure) return { kind: 'unsent', failure };
    const ready = await prepare(abort.signal, (step) => this.change(held, { ...held.turn, preparing: step }));
    if ('kind' in ready) return ready;
    const { route, settings } = ready;
    let prompt = ready.prompt;
    const reply = ready.before ? { ...asked, before: ready.before } : asked;
    // A message sent translated or changed by the bot shows as it is saved from the moment it is made so.
    this.change(held, { ...without(held.turn, 'preparing'), reply, said: ready.said ?? said, ...(settings.streaming === false && { whole: true as const }) });
    const sending = ready.said && appendUserMessage(this.store, chat, ready.said);
    const target = { chat, result: reply.id, for: { kind: 'reply' as const, message: reply.message, replaces: reply.replaces, ...(reply.follows !== undefined && { follows: reply.follows }), continues: reply.continues, ...(reply.before && { before: reply.before }) } };
    const batching = { waiting: () => this.change(held, { ...held.turn, whole: true, batch: true }), cancel: held.cancel.signal };
    let decision = ready.calibration;
    let answer: Reply;
    let call: Awaited<ReturnType<typeof newCall>>;
    for (;;) {
      call = await newCall({ store: this.store, tokens: this.tokens }, route, { id: crypto.randomUUID(), ...target });
      if (decision) call.calibration = { ...call.calibration!, ...decision };
      call.retrying = this.retrying(held);
      this.reading.add(call.id);
      held.calling = call.id;
      const replying = generate({ credentials: this.credentials, log: this.log, connection: route.connection.value, model: route.model, settings, retries: retriesOf(this.store, route.connection.value, settings), messages: prompt.messages, call, signal: abort.signal, onText: this.writer(held, true), inline: this.inline(held), batching });
      const sent = await sending;
      if (sent && !sent.ok) {
        held.cancel.abort();
        abort.abort();
        endCall(this.store, call.id);
        await replying;
        return { kind: 'unsent', failure: sent };
      }
      answer = await replying;
      if (!answer.contextRefusal || !ready.refit || abort.signal.aborted || this.closed) break;
      const fitted = await ready.refit(answer.contextRefusal, answer.calibration.measurement);
      if (!fitted) break;
      // No receipt, ledger row or visible retry state for a context refusal.
      endCall(this.store, call.id);
      this.reading.delete(call.id);
      prompt = fitted.prompt;
      decision = { fit: fitted.fit, retries: fitted.retries };
    }
    if (this.closed) return null;
    const forecast = answer.calibration.retries.length ? undefined : ready.forecast;
    // Kept before the save, whose store change is what shows the reply's 정보.
    const wire = answer.cache ? wireTextOf(answer.cache) : undefined;
    const diagnose = forecast && wire && ready.diagnose;
    this.log.attach(chat, call.id, { prompt, forecast, wire, diagnosis: diagnose ? undefined : null });
    if (diagnose) void diagnose(prompt, wire!).then((diagnosis) => this.log.attach(chat, call.id, { diagnosis }));
    const written = this.written(held, reply, callOf(route), answer, Date.now(), forecast, ready.preread, ready.agents);
    // A receipt's cache is the view's, so one kept means the answer has its view.
    const printing = cacheKept(written.receipt) && writePrint(this.store, chat, call.id, wireOf(route.connection.id, answer.account, answer.cache!, prompt.parts));
    const saved = await this.save(chat, await this.ended(chat, written), call.id);
    await printing;
    return saved;
  }

  // A reply the server was writing when this page came, which Streams hands over; it waits while its chat has a turn.
  // One not saved is not reported: its marker stays, and the next pick-up saves it again. One a restore ended goes with
  // the timeline it was begun on (save).
  async resume(stream: Stored<'stream'>) {
    const purpose = stream.value.for;
    const chat = stream.parent!;
    if (this.closed || purpose.kind !== 'reply' || this.turns.has(chat)) return;
    const lease = this.store.retainChat(chat);
    const reply = { id: stream.value.result, message: purpose.message, replaces: purpose.replaces, ...(purpose.follows !== undefined && { follows: purpose.follows }), continues: purpose.continues, ...(purpose.before && { before: purpose.before }) };
    const held = this.seat(chat, null, reply);
    if ('batch' in stream.value) this.change(held, { ...held.turn, whole: true, batch: true });
    this.reading.add(stream.id);
    held.calling = stream.id;
    try {
      await this.store.pinned(async () => {
        if (await lease.ready) return;
        const answer = await resume({ store: this.store, credentials: this.credentials, log: this.log }, stream, held.abort.signal, this.writer(held), this.inline(held), { retrying: this.retrying(held), cancel: held.cancel.signal });
        // Not Date.now(): the call may have ended long before this page read it, and the cache timer counts back from at.
        const at = stream.value.at + answer.totalMs;
        if (!this.closed) await this.save(chat, await this.ended(chat, this.written(held, reply, stream.value.call, answer, at)), stream.id);
      });
    } finally {
      this.unseat(held);
      lease.release();
    }
  }

  private retrying(held: Held) {
    return () => this.change(held, { ...held.turn, retrying: true });
  }

  // started: the reply's text begins here, so its first chunk cues; never for one picked up mid-way (resume), a
  // continuation, whose text starts as the one it continues, or one shown whole.
  private writer(held: Held, started = false) {
    return (phase: Phase, chunk: string) => {
      if (started && phase === 'text' && held.turn.text === '' && !held.turn.whole) this.cues.emit('reply-started');
      this.change(held, { ...held.turn, [phase]: held.turn[phase] + chunk });
    };
  }

  // A chat without a character has no 추론을 본문에 표시, and strips.
  private inline(held: Held): InlineThoughts {
    const character = this.store.get('chat', held.turn.chat)?.value.character;
    const keep = character ? this.store.get('character', character)?.value.keepThoughts === true : false;
    return { keep, takeBack: (chars) => this.change(held, { ...held.turn, reasoning: held.turn.reasoning.slice(0, held.turn.reasoning.length - chars) }) };
  }

  private written({ turn }: Held, reply: Turn['reply'], call: Stream['call'], answer: Reply, at: number, forecast?: CacheForecast, preread?: Ask['preread'], agents?: AgentRun[]): Written {
    const made: Receipt = { ...receiptOf(call, answer), ...(forecast && { forecast }), ...(reply.continues && { continues: reply.continues.receipt }), ...(agents?.length && { agents }) };
    const receipt: Receipt = preread ? { ...made, preread: preread(made) } : made;
    return { id: reply.id, message: reply.message, replaces: reply.replaces, ...(reply.follows !== undefined && { follows: reply.follows }), at, text: turn.text, receipt, seed: reply.continues?.seed, ...(reply.before && { before: reply.before }), ...(turn.reasoning && { reasoning: turn.reasoning }) };
  }
}

// A 삽화 scene (runtime/illustrate), a likeness (runtime/likeness) or a mascot's line (runtime/mascot), read through the
// server's stream like any model call but with no marker: a pick-up on another device would make it again and pay for
// it twice. The caller parses the text.
export async function pageAnswer(session: Pick<Session, 'store' | 'tokens' | 'credentials' | 'log'>, { route, settings }: { route: Route; settings: ModelSettings }, requestClass: Exclude<PageClass, 'script'>, chat: string | null, messages: GenerateInput['messages'], signal: AbortSignal, retrying?: () => void): Promise<{ kind: 'stopped' } | { kind: 'failed'; receipt: Receipt } | { text: string; receipt: Receipt }> {
  const { store, credentials, log } = session;
  const text = gather();
  const call = await pageCall(session, route, requestClass, chat);
  call.retrying = retrying;
  const answer = await generate({ credentials, log, connection: route.connection.value, model: route.model, settings, retries: retriesOf(store, route.connection.value, settings), messages, call, signal, onText: text.add }).finally(() => endCall(store, call.id));
  if (answer.cut === 'stopped') return { kind: 'stopped' };
  const receipt = unsettled(receiptOf(callOf(route), answer));
  return answer.state === 'done' ? { text: text.value(), receipt } : { kind: 'failed', receipt };
}
