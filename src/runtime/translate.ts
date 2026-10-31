import type { Tokens } from './token-calibration';
import { ChangeSignal } from '../change-signal';
import type { RanAway } from '../engine/pipeline';
import { toolPrompt } from '../engine/translate';
import type { ChatScope } from '../engine/render';
import type { TranslationRequest } from '../engine/translate';
import { restore, type ProtectInvalid } from '../engine/protect';
import type { Chat, Receipt, Translation, Version } from '../model/chat';
import type { Stored } from '../model/kinds';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import { without } from '../model/fields';
import type { TranslatePrompt } from '../model/prompt';
import type { Stream } from '../model/stream';
import type { ApiFailure, ApiResult } from './api';
import { sharedModel, taskModel, type Route, type RouteFailure } from './assignment';
import { setTextTranslation, translatorNotes } from './characters';
import { chatTranslate, SHARED_CHAT } from './features';
import { scopeOf } from './chat-context';
import { appendTranslation, savedElsewhere, type Written } from './chat-log';
import { retriesOf } from './connections';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import type { RequestLog } from './request-log';
import { gather, generate, receiptOf, resume, type Reply } from './generate';
import { callOf, endCall, newCall, type CallTarget } from './streams';
import { modelProfile } from './profiles';
import { translationPrompt } from './prompts';
import type { ObjectStore } from './store';
import { keepRow } from './usage';
import { evaluatingTask, type Lane } from './evaluation';
import type { Cues } from './cues';

// take: the display scripts that draw the status window (상태창 지정), whose boxes the source leaves out.
// language: what the text is translated into. lane: auto-translation for 응답 번역, which a chat judged stuck refuses;
// null for a text of no chat (translateText).
export type TranslateInput = { chat: Chat; scope: ChatScope; take: ReadonlySet<number>; translations: (string | null)[]; request: TranslationRequest; language: string; lane: Lane<'translation' | 'auto-translation'> | null };

// failed: the call's receipt says why, and a cut one that wrote nothing is failed too. protected-lost: the answer left
// out count of the source's protected spans, so it is not saved as if whole.
export type TranslateFailure =
  | RouteFailure
  | { kind: 'prompt-missing'; own: boolean }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'stopped' }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'protected-lost'; count: number }
  | ProtectInvalid
  | RanAway;

export type TranslationTarget = Omit<CallTarget, 'for'> & { for: Extract<Stream['for'], { kind: 'translation' | 'input' }> };

type Deps = { store: ObjectStore; credentials: Credentials; log: RequestLog; tokens: Tokens };

// A character's text, as a new chat of its would translate it (its card's texts).
export const translateText = (session: Deps, chat: Chat, text: string, language: string, signal: AbortSignal, onText: (text: string) => void) =>
  translateLoose(session, chat, text, language, (input, target) => translate(session, input, target, signal, onText));

export function translateOnTool(session: Deps, text: string, language: string, signal: AbortSignal, onText: (text: string) => void) {
  const tool = toolTranslatorOf(session.store);
  if (!tool.ok) return Promise.resolve(tool);
  return translateLoose(session, SHARED_CHAT, text, language, (input, target) => translateWith(session, tool.with, input, target, signal, onText));
}

// Non-story text must not receive a card/persona as its own translation context.
// No marker is kept: end the call even after abort, which only stops reading.
function translateLoose(session: Deps, chat: Chat, text: string, language: string, run: (input: TranslateInput, target: TranslationTarget) => ReturnType<typeof translate>) {
  const input: TranslateInput = { chat, scope: { ...scopeOf(session, null, chat, []), persona: null, card: null }, take: new Set(), translations: [], request: { kind: 'input', text }, language, lane: null };
  const target: TranslationTarget = { id: crypto.randomUUID(), chat: null, result: crypto.randomUUID(), for: { kind: 'input', typed: text, language } };
  return run(input, target).then(async (made) => {
    if (made.ok) await keepRow(session.store, made.translation.receipt!, made.translation.at, { chat: null, character: chat.character });
    return made;
  }).finally(() => endCall(session.store, target.id));
}

// What a translation goes out with: a chat's (translatorOf, translatorNotes) or 번역기's (toolTranslatorOf).
export type TranslateWith = { prompt: TranslatePrompt; route: Route; notes: string };

export function translate(deps: Deps, input: TranslateInput, target: TranslationTarget, signal: AbortSignal, onText: (text: string) => void): Promise<Translated> {
  const translator = translatorOf(deps.store, input.chat);
  if (!translator.ok) return Promise.resolve(translator);
  return translateWith(deps, { ...translator, notes: translatorNotes(deps.store, input.chat.character) }, input, target, signal, onText);
}

// A translation cut at its length keeps what it wrote, and its receipt says it was cut, unless the cut took a protected
// span (protected-lost).
export async function translateWith(
  { store, credentials, log, tokens }: Deps,
  { prompt, route, notes }: TranslateWith,
  { scope, take, translations, request, language, lane }: TranslateInput,
  target: TranslationTarget,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<Translated> {
  const profile = modelProfile(store, route.model);
  if (profile.kind === 'missing') return { ok: false, failure: { kind: 'profile-missing', own: profile.own } };
  const assembled = await evaluatingTask(store.evaluation.translation(lane, { scope, take, prompt, translations, notes, request, language, seed: crypto.randomUUID() }, signal));
  if ('kind' in assembled) return { ok: false, failure: assembled };
  const { spans } = assembled;
  const text = gather((live) => onText(restore(live, spans).text));
  const answer = await generate({
    credentials,
    log,
    connection: route.connection.value,
    model: route.model,
    settings: profile.profile.value.settings,
    retries: retriesOf(store, route.connection.value, profile.profile.value.settings),
    messages: assembled.messages,
    call: await newCall({ store, tokens }, route, spans.length ? { ...target, for: { ...target.for, spans } } : target),
    signal,
    onText: text.add,
  });
  return translated(callOf(route), answer, text.value(), spans, language);
}

// A translation the server was already making when this page came (tech-spec §6, Detached replies). Only a saved
// chat's translations are picked up, so no language is needed: a greeting's translation is never one of them.
export async function resumeTranslation(deps: Pick<Deps, 'store' | 'credentials' | 'log'>, stream: Stored<'stream'>, signal: AbortSignal, onText: (text: string) => void): Promise<Translated> {
  const purpose = stream.value.for;
  const spans = 'spans' in purpose ? (purpose.spans ?? []) : [];
  const text = gather((live) => onText(restore(live, spans).text));
  const answer = await resume(deps, stream, signal, text.add);
  return translated(stream.value.call, answer, text.value(), spans, null);
}

type Translated = { ok: true; translation: Translation; language: string | null } | { ok: false; failure: TranslateFailure };

function translated(call: Stream['call'], answer: Reply, text: string, spans: readonly string[], language: string | null): Translated {
  if (answer.cut === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
  const receipt = receiptOf(call, answer);
  if (answer.state === 'failed' || !text.trim()) return { ok: false, failure: { kind: 'failed', receipt } };
  const restored = restore(text, spans);
  // A translation cut at its length lost its tail, the tokens in it too: it is saved as 번역 잘림, as any cut one.
  if (restored.missing && answer.cut === null) return { ok: false, failure: { kind: 'protected-lost', count: restored.missing } };
  return { ok: true, translation: { text: restored.text.trim(), receipt, at: Date.now() }, language };
}

export function translatorOf(store: ObjectStore, chat: Chat): { ok: true; prompt: TranslatePrompt; route: Route } | { ok: false; failure: RouteFailure | { kind: 'prompt-missing'; own: boolean } } {
  const prompt = translationPrompt(store, chatTranslate(store, chat).prompt);
  if (prompt.kind === 'missing') return { ok: false, failure: { kind: 'prompt-missing', own: prompt.own } };
  const route = taskModel(store, chat, prompt.prompt.value.model);
  return 'kind' in route ? { ok: false, failure: route } : { ok: true, prompt: prompt.prompt.value, route };
}

// 번역기 (user, 2026-10-20): a tool apart from every chat, for any text, so it takes neither the chat translation's
// prompt nor its 전역 번역가의 노트: a plain prompt of its own, 설정 › 모델's 보조 모델 and its own note.
export function toolTranslatorOf(store: ObjectStore): { ok: true; with: TranslateWith } | { ok: false; failure: RouteFailure } {
  const route = sharedModel(store, 'aux');
  if ('kind' in route) return { ok: false, failure: route };
  return { ok: true, with: { prompt: TOOL_PROMPT, route, notes: store.get('settings', SETTINGS_ID)?.value.toolNote ?? '' } };
}

const TOOL_PROMPT = toolPrompt();

export const setToolLanguage = (store: ObjectStore, name: string) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, toolLanguage: name }));

export const setToolNote = (store: ObjectStore, text: string) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (text.trim() ? { ...current, toolNote: text } : without(current, 'toolNote')));

// A prompt made before the 번역가의 노트 slot existed, the stored 기본 번역 among them, sends no note until the user adds
// the block.
export const sendsNotes = (prompt: TranslatePrompt) => prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'note');

export type TranslatorFailure = Exclude<TranslateFailure, { kind: 'stopped' }>;

// awaited: replies saved here whose 응답 번역 has not started yet (expect). failed: why the last try at a version did not
// translate it, kept for the session.
export type Translating = { awaited: ReadonlySet<string>; live: ReadonlyMap<string, string>; failed: ReadonlyMap<string, TranslatorFailure> };

// Unlike replies, several run at once, one per version, and each goes on when its chat is left.
export class Translator {
  private closed = false;
  private state: Translating = { awaited: new Set(), live: new Map(), failed: new Map() };
  private readonly aborts = new Map<string, AbortController>();
  private readonly changes = new ChangeSignal();

  constructor(
    private readonly store: ObjectStore,
    private readonly credentials: Credentials,
    private readonly log: RequestLog,
    private readonly costs: Costs,
    private readonly tokens: Tokens,
    // The calls this page reads (runtime/streams).
    private readonly reading: Set<string>,
    private readonly cues: Cues,
  ) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  // A reply saved with 응답 번역 on is awaited from its save, before its turn ends, until its translation starts or
  // translateReceived passes it over and the returned settle is called.
  expect(chat: string, reply: Written): () => void {
    const stored = this.store.get('chat', chat)?.value;
    if (this.closed || reply.receipt.state === 'failed' || !reply.text.trim() || !stored || !chatTranslate(this.store, stored).replies) return () => {};
    this.change(reply.id, { awaited: true });
    return () => { if (this.state.awaited.has(reply.id)) this.change(reply.id, { awaited: false }); };
  }

  private change(version: string, change: { awaited?: boolean; live?: string | null; failed?: TranslatorFailure | null }) {
    const next = { awaited: new Set(this.state.awaited), live: new Map(this.state.live), failed: new Map(this.state.failed) };
    if (change.awaited) next.awaited.add(version);
    else if (change.awaited === false) next.awaited.delete(version);
    if (change.live === null) next.live.delete(version);
    else if (change.live !== undefined) next.live.set(version, change.live);
    if (change.failed === null) next.failed.delete(version);
    else if (change.failed) next.failed.set(version, change.failed);
    this.state = next;
    this.changes.notify();
  }

  // Unsaved chats keep greeting translations on the character. closed prevents follow-up calls after lock.
  // Resolve after save/failure, but do not await another translation already running for that version.
  translate(chat: string, { id: version, text: original }: Version, input: TranslateInput): Promise<void> {
    if (this.closed || this.aborts.has(version)) return Promise.resolve();
    const target: TranslationTarget = { id: crypto.randomUUID(), chat: this.store.get('chat', chat) ? chat : null, result: crypto.randomUUID(), for: { kind: 'translation', version } };
    return this.run(chat, version, target, (signal, onText) => translate({ store: this.store, credentials: this.credentials, log: this.log, tokens: this.tokens }, input, target, signal, onText), (made) =>
      this.store.get('chat', chat)
        ? appendTranslation(this.store, chat, version, made.translation, target.result)
        : setTextTranslation(this.store, input.chat.character!, original, made.language!, made.translation).then(async (saved) => {
          if (saved.ok) await keepRow(this.store, made.translation.receipt!, made.translation.at, { chat: null, character: input.chat.character });
          return saved;
        }),
    );
  }

  resume(stream: Stored<'stream'>, version: string) {
    const chat = stream.parent!;
    if (this.closed || this.aborts.has(version)) return;
    void this.run(chat, version, { id: stream.id, result: stream.value.result }, (signal, onText) => resumeTranslation({ store: this.store, credentials: this.credentials, log: this.log }, stream, signal, onText), (made) =>
      appendTranslation(this.store, chat, version, made.translation, stream.value.result),
    );
  }

  // A failed call ends with its marker, since nothing would make it go otherwise; one stopped by close() keeps it
  // for the next load.
  private run(chat: string, version: string, { id, result }: { id: string; result: string }, make: (signal: AbortSignal, onText: (text: string) => void) => Promise<Translated>, save: (made: Extract<Translated, { ok: true }>) => Promise<ApiResult<unknown>>): Promise<void> {
    const lease = this.store.retainChat(chat);
    const abort = new AbortController();
    this.aborts.set(version, abort);
    this.reading.add(id);
    this.change(version, { awaited: false, live: '', failed: null });
    return lease.ready.then(async (failure) => {
      if (failure) {
        this.change(version, { live: null, failed: { kind: 'unsaved', failure } });
        return null;
      }
      return make(abort.signal, (text) => this.change(version, { live: text }));
    })
      .then(
        async (made) => {
          if (!made) return;
          if (!made.ok) {
            if (made.failure.kind !== 'stopped') endCall(this.store, id);
            return this.change(version, { live: null, failed: made.failure.kind === 'stopped' ? null : made.failure });
          }
          const saved = await save(made);
          if (!saved.ok && !savedElsewhere(this.store, chat, result, saved)) return this.change(version, { live: null, failed: { kind: 'unsaved', failure: saved } });
          // The live text goes once the store holds the translation, so the original never shows in between.
          this.change(version, { live: null, failed: null });
          endCall(this.store, id);
          if (saved.ok) this.cues.emit('translated');
          // The device that saved it counts its cost.
          if (saved.ok && this.store.get('chat', chat)) this.costs.settle(chat, made.translation.receipt!);
        },
        (error: unknown) => {
          this.change(version, { live: null });
          throw error;
        },
      )
      .finally(() => {
        this.aborts.delete(version);
        this.reading.delete(id);
        lease.release();
      });
  }

  close() {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
  }
}
