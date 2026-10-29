import { providerFit } from './token-calibration';
import { answerInstructionOf, translationInput, tokenLimits, sentSettings } from './chat-context';
import { cacheSend, gatherTurn, type Target, type Blocked, type TurnContext } from './turn-context';
import { forecast, prior } from './cache';
import { diagnoseCache, needsDiagnosis } from './cache-diagnosis';
import type { RanAway } from '../engine/pipeline';
import type { TooLong } from '../engine/prompt-budget';
import { fold, shown, type Chat } from '../model/chat';
import { live } from '../model/library';
import type { Stored } from '../model/kinds';
import { chatIllustrate, chatTranslate, featuresOf } from './features';
import type { Session } from './session';
import type { ApiFailure } from './api';
import type { Halted } from './script-turns';
import { appendUserMessage, type Written } from './chat-log';
import type { Ask, TalkFailure } from './talk';
import { EvaluationFailed, EvaluationStopped, evaluationFailure } from './evaluation';
import { endCall } from './streams';
import { resumeTranslation, translate, type TranslateFailure, type TranslationTarget } from './translate';
import { findRecords } from './retrieval';
import { preread } from './preread';
import { withPictures } from './attachments';
import { attachmentLead } from '../engine/assets';
import { agentsOf, preAgents } from './agents';
import type { Preparing, Skip, StepFailure } from './turn-steps';

// kept prevents returning saved text to the composer: Lua bots save the user's message before onStart can fail.
export type TurnFailure = (
  | TalkFailure
  | Blocked
  | TooLong
  | RanAway
  | { kind: 'tokenizer' }
  | { kind: 'unstarted'; failure: ApiFailure }
  | { kind: 'unpulled'; failure: ApiFailure }
  | { kind: 'gone' }
  | { kind: 'untranslated'; failure: TranslateFailure }
  | StepFailure
) & { kept?: true };

// Auto-translate only replies received here, never existing messages, greetings or version/switch changes (user, 2026-10-04).
// Re-read after onOutput, which may edit/delete the saved message. Keep the chat loaded until this returns.
async function translateReceived(session: Pick<Session, 'store' | 'read' | 'translator'>, chat: string, message: string) {
  const view = await displayed(session, chat);
  if (!view || !chatTranslate(session.store, view.chat).replies) return;
  const index = view.messages.findIndex(({ id }) => id === message);
  if (index === -1) return;
  const version = shown(view.messages[index]!);
  // Another version, already translated, may have been switched to while onOutput ran.
  if (version.translation || !view.display.texts[index]!.trim()) return;
  void session.translator.translate(chat, version, { ...translationInput(session, chat, view.chat, view.messages, { kind: 'message', index }), lane: { asker: 'auto-translation', chat } });
}

const displayed = (session: Pick<Session, 'read'>, chat: string) =>
  session.read.displayed(chat).catch((error: unknown) => {
    if (error instanceof EvaluationStopped || error instanceof EvaluationFailed) return null;
    throw error;
  });

// Auto-continue once after length/no-terminal cuts (user, 2026-10-02).
// Never auto-continue any continuation, manual stops or empty replies.
export function autoContinue({ text, receipt }: Pick<Written, 'text' | 'receipt'>): boolean {
  return receipt.state === 'cut' && (receipt.cut === 'length' || receipt.cut === 'no-terminal') && !receipt.continues && text !== '';
}

const idle = (talk: Session['talk'], chat: string) =>
  new Promise<void>((done) => {
    if (!talk.snapshot(chat)) return done();
    const stop = talk.subscribe(() => {
      if (talk.snapshot(chat)) return;
      stop();
      done();
    });
  });

// Keep the chat loaded: auto-continue the still-latest saved cut, otherwise polish then translate.
// Never translate both: a continuation's save hook owns its final version. A competing turn can block continuation,
// leaving the cut untranslated until another action.
export async function receiveReply(session: Session, chat: string, reply: Written) {
  if (reply.receipt.state === 'failed') return;
  if (autoContinue(reply)) {
    // The reply's own turn still holds its chat in Talk when its save calls the hook.
    await idle(session.talk, chat);
    const last = (await displayed(session, chat))?.messages.at(-1);
    // An onOutput edit is a version of its own, which is not continued, as 이어 쓰기 is not offered on it.
    if (last?.id === (reply.message ?? reply.id) && shown(last).id === reply.id) {
      const failure = await takeTurn(session, chat, { kind: 'continue', message: last.id, version: reply.id });
      if (!failure) return;
    }
  }
  // 멈추기 is pressed by someone watching the reply.
  if (reply.receipt.cut !== 'stopped') session.cues.emit('reply-received');
  const message = reply.message ?? reply.id;
  await polished(session, chat, message, reply.id);
  const received = shownReceived(session, chat, message);
  if (!received) return;
  if (chatIllustrate(session.store, received.chat).auto) session.illustrator.draw(chat, received.message, received.version, { auto: true });
  if (featuresOf(session.store, received.chat).mascot) session.commentator.comment(chat, received.message, received.version);
}

async function polished(session: Session, chat: string, message: string, version: string) {
  await session.polisher.polish(chat, message, version);
  await translateReceived(session, chat, message);
}

// 다시 다듬기 (design §6.16): the post agents again on the version shown, from its text as written, which is then
// translated as a reply just received is. 삽화 and 마스코트 stay with what they made of it.
export async function polishAgain(session: Session, chat: string, message: string, version: string) {
  const lease = session.store.retainChat(chat);
  try {
    if (await lease.ready) return;
    await polished(session, chat, message, version);
  } finally {
    lease.release();
  }
}

// What 삽화 on auto draws for and the mascot speaks on, as 응답 번역 translates it: the version of a reply received here
// shown once the bot's onOutput ran, after any continuation, never the cut one it continued. null for a chat gone or a
// version with no text.
function shownReceived({ store }: Pick<Session, 'store'>, chat: string, received: string): { chat: Chat; message: string; version: string } | null {
  const stored = live(store.get('chat', chat));
  if (!stored) return null;
  const message = fold(store.children('entry', chat)).find(({ id }) => id === received);
  const version = message && shown(message);
  return version?.text.trim() ? { chat: stored.value, message: message!.id, version: version.id } : null;
}

// Share the new-chat save with greeting actions; a second create would conflict.
// Follow its saved greeting selection while the turn remains visible on the new chat.
export type Starting = { greeting: string | null; saved: Promise<ApiFailure | null> };

export function takeTurn(session: Session, chat: string, target: Target, start: Starting | null = null, skip: Skip = {}): Promise<TurnFailure | null> {
  const ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() };
  const again = (answer: boolean) => gatheredTurn(session, chat, answer ? { kind: 'answer' } : target, ids);
  if (start) {
    const { greeting } = start;
    const said = target.kind === 'send' ? { id: ids.said, text: target.text, follows: greeting } : null;
    return unhalted(session.talk.run({ chat, said, reply: { id: ids.reply, message: null, replaces: null, follows: said ? said.id : greeting, continues: null } }, async (signal, preparing) => {
      const unstarted = await start.saved;
      if (unstarted) return { kind: 'unstarted', failure: unstarted };
      // The chat was just saved and a new chat's target names no message, so it is there.
      const turn = (await gatheredTurn(session, chat, target, ids))!;
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again, preparing, skip);
    }));
  }
  const lease = session.store.retainChat(chat);
  const send = (): Promise<TurnFailure | null> => {
    const showing = gatherTurn(session, chat, target, ids);
    if (showing === null || 'kind' in showing) return Promise.resolve(showing);
    return unhalted(session.talk.run({ chat, said: showing.said, reply: showing.reply }, async (signal, preparing) => {
      // Another device may have written to this chat while this page stood open without focus or a timer's pull, so the
      // prompt is gathered again after a pull. A turn it cannot pull does not send on what may be stale.
      const unpulled = await session.store.pull();
      if (unpulled) return { kind: 'unpulled', failure: unpulled };
      const turn = await gatheredTurn(session, chat, target, ids);
      if (turn === null) return { kind: 'gone' };
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again, preparing, skip);
    }));
  };
  const sending = lease.ready.then((failure): Promise<TurnFailure | null> => failure ? Promise.resolve({ kind: 'unpulled', failure }) : send());
  return sending.finally(lease.release);
}

// A turn the bot's Lua ended before any request (stopChat) is not a failure: the user's message stays, and nothing
// is said of it.
const unhalted = (turn: Promise<TurnFailure | Halted | null>): Promise<TurnFailure | null> => turn.then((failure) => (failure?.kind === 'halted' ? null : failure));

// Stopped with the turn, or a worker that failed. Either way the screen puts the typed text back and reports it, as for
// any message not sent.
type Unevaluated = { kind: 'unsent'; failure: ApiFailure };
const evaluating = <T>(work: Promise<T>): Promise<T | Unevaluated> => work.catch((error: unknown) => ({ kind: 'unsent' as const, failure: evaluationFailure(error) }));

// The turn as the chat stands once what was last written to it is evaluated: a write returns before its chat's
// projection is made again (ChatProjections.refreshHeld).
async function gatheredTurn(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, ids: Parameters<typeof gatherTurn>[3]): Promise<TurnContext | Blocked | Unevaluated | null> {
  const evaluated = await evaluating(session.store.projections.evaluate(chat));
  return evaluated && 'kind' in evaluated ? evaluated : gatherTurn(session, chat, target, ids);
}

async function prepare(session: Session, chat: string, gathered: TurnContext, signal: AbortSignal, again: (answer: boolean) => Promise<TurnContext | Blocked | Unevaluated | null>, preparing: (step: Preparing) => void, skip: Skip): Promise<Ask | Halted | TurnFailure> {
  const translated = gathered.said && chatTranslate(session.store, gathered.chat).input ? await sendTranslated(session, chat, gathered, signal) : gathered;
  if ('kind' in translated) return translated;
  const started = await session.scriptTurns.starting(chat, translated, again, signal);
  if ('kind' in started) return started;
  const prompted = await session.scriptTurns.prompting(chat, started.turn, () => again(translated.said !== null && started.turn.said === null), signal);
  if ('kind' in prompted) return prompted;
  if (signal.aborted) return { kind: 'halted' };
  const { turn, tools } = prompted;
  const { route, settings, scope, budget, said, reply } = turn;
  const memory = turn.memory?.kind === 'built-in' ? { ...turn.memory, found: await findRecords(session, chat, scope.messages, signal) } : turn.memory;
  const kept = translated.said !== null && said === null ? { kept: true as const } : {};
  const agents = !skip.agents && reply.continues === null && agentsOf(session.store, turn.chat).pre.length > 0 ? await runPre(session, chat, turn, signal, preparing, skip) : { runs: [], notes: '' };
  if ('kind' in agents) return { kind: 'halted' };
  if ('failure' in agents) return { kind: 'agent', failure: agents, ...kept };
  const snapshot = await session.tokens.snapshot(route, settings, tokenLimits(route.model, sentSettings(session.store, route)), 'conversation', chat, signal);
  if (!snapshot.ok) return { kind: 'unsent', failure: snapshot, ...kept };
  const calibration = snapshot.data;
  const fit = providerFit(route, settings, calibration.fit.allowance);
  const prompt = await evaluating(session.store.evaluation.prompt({ asker: 'send', chat }, { tools, scope, seed: reply.id, budget, fit, continuing: reply.continues !== null, answerInstruction: answerInstructionOf(session.store), memory, notes: agents.notes, pictures: turn.pictures }, signal));
  if ('kind' in prompt) return { ...prompt, ...kept };
  const requested = await session.scriptTurns.requesting(chat, turn, prompt, signal, (name) => preparing({ step: 'tools', running: name, since: Date.now() }));
  if (signal.aborted) return { kind: 'halted' };
  const rewritten = await evaluating(session.store.evaluation.rewrite({ asker: 'send', chat }, scope, { prompt, messages: requested.messages, fit }, signal));
  if ('kind' in rewritten) return { ...rewritten, ...kept };
  // After the scripts, so a bot's Lua sees the prompt as built and never the brief; before the forecast and the refit,
  // which compare and fit what is sent.
  const shortened = !skip.preread && featuresOf(session.store, turn.chat).preread ? await preread(session, chat, turn.chat, scope, rewritten, route, reply.id, signal, (retrying) => preparing({ step: 'preread', ...(retrying && { retrying }) })) : { prompt: rewritten, preread: null };
  if ('kind' in shortened) return { kind: 'preread', failure: shortened, ...kept };
  const sent = shortened.prompt;
  // Last, so the worker and the bot's scripts carry each picture's id, never its bytes.
  const pictured = await withPictures(session, sent, signal);
  if (signal.aborted) return { kind: 'halted' };
  if (!pictured.ok) return { kind: 'unsent', failure: pictured, ...kept };
  const before = [...(reply.before ?? []), ...requested.writes];
  const send = cacheSend({ turn, prompt: sent, calibration }, session.credentials.pool.peek(route.connection.value)?.id ?? null);
  const last = prior(session.store, chat, session.read.chat(chat).snapshot()!.messages, Date.now());
  const predicted = send && forecast(last, send);
  const against = predicted?.against;
  const diagnose: Ask['diagnose'] = predicted && needsDiagnosis(predicted) ? (prompt, wire) => diagnoseCache(session.store.evaluation, chat, scope, predicted, last ? session.log.entry(chat, last.print.call) : null, prompt, wire) : undefined;
  const refit: Ask['refit'] = async (refusal, measurement) => {
    const decision = calibration.refused(refusal, measurement);
    if (!decision) return null;
    const fitted = await evaluating(session.store.evaluation.rewrite({ asker: 'send', chat }, scope, { prompt: sent, messages: sent.messages, fit: { ...fit, allowance: decision.allowance } }, signal));
    const refitted = 'kind' in fitted ? null : await withPictures(session, fitted, signal);
    return refitted?.ok ? { prompt: refitted.data, fit: decision, retries: [...calibration.retries] } : null;
  };
  // A model whose catalog says it takes no tools is offered none; its plugins' other moments run as ever.
  const calling = route.model.tools === false ? null : session.scriptTurns.calling(chat, turn, signal);
  return { route, settings, prompt: pictured.data, ...(calling && { tools: calling }), ...(diagnose && { diagnose }), calibration: { fit: calibration.fit, retries: [] }, refit, said, ...(before.length > 0 && { before }), ...(against && { forecast: against }), ...(shortened.preread && { preread: shortened.preread }), ...(agents.runs.length > 0 && { agents: agents.runs }) };
}

// The reply's message's other versions, the one it takes the place of first, are where its pre notes are found again.
function runPre(session: Session, chat: string, turn: TurnContext, signal: AbortSignal, preparing: (step: Preparing) => void, skip: Skip) {
  const { reply } = turn;
  const messages = session.read.chat(chat).snapshot()!.messages;
  const at = reply.message === null ? messages.length : messages.findIndex(({ id }) => id === reply.message);
  const versions = reply.message === null ? [] : (messages[at]?.versions ?? []);
  const again = skip.notes ? [] : [...versions.filter(({ id }) => id === reply.replaces), ...versions.filter(({ id }) => id !== reply.replaces).reverse()];
  return preAgents(session, chat, turn.chat, turn.scope, messages.slice(0, at), again, signal, (now) => preparing({ step: 'agents', ...now }));
}

// Resume input translations without auto-reply: another device may read the same call.
// Save translated text or fall back to the typed text on failure so input is never lost.
export async function resumeSend(session: Pick<Session, 'store' | 'credentials' | 'log' | 'streams'>, stream: Stored<'stream'>, signal: AbortSignal) {
  const purpose = stream.value.for;
  if (purpose.kind !== 'input') return;
  const lease = session.store.retainChat(stream.parent!);
  try {
    if (await lease.ready) return;
    session.streams.reading.add(stream.id);
    const made = await resumeTranslation(session, stream, signal, () => {}).finally(() => session.streams.reading.delete(stream.id));
    if (!made.ok && made.failure.kind === 'stopped') return;
    const id = stream.value.result;
    const follows = purpose.follows !== undefined && { follows: purpose.follows };
    const said = made.ok ? { id, text: attachmentLead(purpose.typed).lead + made.translation.text, ...follows, translation: { ...made.translation, text: purpose.typed, sentIn: purpose.language } } : { id, text: purpose.typed, ...follows };
    const saved = await appendUserMessage(session.store, stream.parent!, said);
    if (!saved.ok && saved.error === 'stopped') return;
    if (saved.ok || session.store.children('entry', stream.parent!).some((entry) => entry.id === id)) endCall(session.store, stream.id);
  } finally { lease.release(); }
}

// Store/send translated text, retaining typed text as its translation; earlier chat messages provide context.
// End the call before saving: leaving its marker would let resume duplicate Talk's message write.
async function sendTranslated(session: Session, chat: string, turn: TurnContext, signal: AbortSignal): Promise<TurnContext | Extract<TurnFailure, { kind: 'untranslated' }>> {
  const typed = turn.said!;
  // The translation's text renders a picture's tag to nothing, so the pictures stay out of it and lead its result.
  const { lead, text } = attachmentLead(typed.text);
  if (!text.trim()) return turn;
  const messages = session.read.chat(chat).snapshot()!.messages;
  const input = translationInput(session, chat, turn.chat, messages, { kind: 'input', text });
  const { language } = input;
  const target: TranslationTarget = { id: crypto.randomUUID(), chat, result: typed.id, for: { kind: 'input', typed: typed.text, language, ...(typed.follows !== undefined && { follows: typed.follows }) } };
  session.streams.reading.add(target.id);
  const made = await translate(session, input, target, signal, () => {}).finally(() =>
    session.streams.reading.delete(target.id),
  );
  endCall(session.store, target.id);
  if (!made.ok) return { kind: 'untranslated', failure: made.failure };
  const sent = lead + made.translation.text;
  const last = turn.scope.messages.at(-1)!;
  return {
    ...turn,
    scope: { ...turn.scope, messages: turn.scope.messages.with(-1, { ...last, text: sent }) },
    said: { id: typed.id, text: sent, ...(typed.follows !== undefined && { follows: typed.follows }), translation: { ...made.translation, text: typed.text, sentIn: language } },
  };
}
