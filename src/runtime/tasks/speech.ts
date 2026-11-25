import { refOf, sameModelRef, type ModelRef } from '../../connectors/assignment';
import { joinAudio } from '../../connectors/audio';
import { resolveConnection } from '../../connectors/registry';
import type { Model, Speaks, Spoken, Voice } from '../../connectors/types';
import { speechParts, speechText } from '../../engine/speech';
import { shown } from '../../model/chat';
import { byName, type Stored } from '../../model/kinds';
import type { Speech } from '../../model/speech';
import type { ApiFailure } from '../api';
import type { ReplyError } from '../models/generate';
import { relayBytes, relayJson } from '../models/relay';
import { noteStep } from '../diagnostics/auto-diagnosis';
import { callLabel } from '../service/pulse';
import type { Session } from '../session';
import { KeyedSnapshot } from '../store/snapshot';
import type { ObjectStore } from '../store/store';
import { chatSpeech } from './features';
import { translationShown } from './translate';

// 음성 (design §6.19): one reading at a time, read as it is made and kept as one file for the next listen. Owns speech
// writes.

export type SpeechRoute = { connection: Stored<'connection'>; model: Model; speaks: Speaks };

// Every speech model of every connection whose type speaks; the first reads where no 음성 모델 is picked.
export const speakingModels = (connections: readonly Stored<'connection'>[]): SpeechRoute[] =>
  byName('connection', connections).flatMap((connection) => {
    const speaks = resolveConnection(connection.value)?.type?.speaks;
    return speaks ? speaks.models.map((model) => ({ connection, model, speaks })) : [];
  });

export function speechRoute(store: Pick<ObjectStore, 'list'>, ref: ModelRef | undefined): SpeechRoute | { kind: 'no-speech-model' } | { kind: 'speech-model-gone' } {
  const routes = speakingModels(store.list('connection'));
  if (!ref) return routes[0] ?? { kind: 'no-speech-model' };
  return routes.find(({ connection, model }) => sameModelRef(refOf(connection.id, model), ref)) ?? { kind: 'speech-model-gone' };
}

export type SpeechFailure =
  | { kind: 'no-speech-model' }
  | { kind: 'speech-model-gone' }
  // None picked, or the one picked is another connection's.
  | { kind: 'no-voice' }
  | { kind: 'empty'; quotes: boolean }
  | { kind: 'unspoken'; error: Exclude<ReplyError, { kind: 'stopped' }> }
  | { kind: 'not-audio' }
  // Stretches the app cannot join into one file; heard, not kept.
  | { kind: 'unjoined' }
  | { kind: 'file-refused' }
  | { kind: 'unsaved'; failure: ApiFailure }
  // The browser plays nothing before a press on the page, as a phone's does.
  | { kind: 'blocked' }
  | { kind: 'unplayable' }
  | { kind: 'gone' };

// making: stretches still being read from the provider; a failure stays until the next play or 닫기.
export type Reading = { chat: string; version: string; making: boolean; playing: boolean; failure: SpeechFailure | null };
export type Readings = ReadonlyMap<string, Reading>;

export type Played = 'ended' | 'stopped' | 'blocked' | 'unplayable';
// What sounds a reading: the page's own player (app), a stand-in in tests.
export type Player = { play(sound: Spoken, signal: AbortSignal): Promise<Played>; unlock(): void };

type Deps = Pick<Session, 'store' | 'read' | 'credentials' | 'files'> & { player: Player };

// Shown on 목소리 while the account's own are read; past this many pages a list is cut where it is.
const VOICE_PAGES = 10;

export async function voicesOf(credentials: Deps['credentials'], connection: Stored<'connection'>, signal: AbortSignal): Promise<{ ok: true; voices: Voice[] } | { ok: false; failure: SpeechFailure }> {
  const speaks = resolveConnection(connection.value)?.type?.speaks;
  if (!speaks) return { ok: false, failure: { kind: 'speech-model-gone' } };
  if (Array.isArray(speaks.voices)) return { ok: true, voices: [...speaks.voices] };
  const listing = speaks.voices as Exclude<Speaks['voices'], readonly Voice[]>;
  const held = await credentials.use(connection.value, signal);
  if (!held.ok) return { ok: false, failure: held.failure.kind === 'stopped' ? { kind: 'gone' } : { kind: 'unspoken', error: held.failure } };
  const voices: Voice[] = [];
  let after: string | null = null;
  for (let page = 0; page < VOICE_PAGES; page++) {
    const answer = await relayJson(listing.request(held.credential, after), signal, undefined, undefined, held.resolved.type);
    if (!answer.ok) {
      if (answer.failure.kind !== 'stopped') held.stale();
      return { ok: false, failure: answer.failure.kind === 'stopped' ? { kind: 'gone' } : { kind: 'unspoken', error: answer.failure } };
    }
    const read = listing.parse(answer.data);
    if (!read) return { ok: false, failure: { kind: 'not-audio' } };
    voices.push(...read.voices);
    if (read.next === null) break;
    after = read.next;
  }
  return { ok: true, voices };
}

// A quarter second of 8 kHz silence: what an unlock plays.
function silence(): Uint8Array<ArrayBuffer> {
  const samples = 2000;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const put = (at: number, text: string) => bytes.set(Uint8Array.from(text, (char) => char.charCodeAt(0)), at);
  put(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  put(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

// One element plays every reading, so the press that unlocked it lets a later reading sound without one (iOS Safari).
// The page's CSP takes media from blob: alone.
export function pagePlayer(): Player {
  let audio: HTMLAudioElement | null = null;
  let unlocked = false;
  const element = () => (audio ??= new Audio());
  const sound = (element: HTMLAudioElement, spoken: Spoken) => {
    const url = URL.createObjectURL(new Blob([spoken.bytes], { type: spoken.type }));
    element.src = url;
    return url;
  };
  return {
    // A refused unlock says nothing: the reading it was for says blocked when it plays.
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const url = sound(element(), { bytes: silence(), type: 'audio/wav' });
      void element().play().catch(() => (unlocked = false)).finally(() => URL.revokeObjectURL(url));
    },
    play(spoken, signal) {
      return new Promise<Played>((resolve) => {
        if (signal.aborted) return resolve('stopped');
        const player = element();
        const url = sound(player, spoken);
        const done = (played: Played) => {
          player.onended = player.onerror = null;
          signal.removeEventListener('abort', stopped);
          player.pause();
          URL.revokeObjectURL(url);
          resolve(played);
        };
        const stopped = () => done('stopped');
        signal.addEventListener('abort', stopped, { once: true });
        player.onended = () => done('ended');
        player.onerror = () => done('unplayable');
        player.play().catch((error: unknown) => done(error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'unplayable'));
      });
    },
  };
}

type Stopped = { kind: 'stopped' };
const STOPPED: Stopped = { kind: 'stopped' };

export class Speaker {
  private closed = false;
  private readonly state = new KeyedSnapshot<Reading>();
  private current: { message: string; abort: AbortController } | null = null;

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.state.subscribe;

  readonly snapshot = this.state.snapshot;

  // A press on the page, so a reading that starts later without one (자동 읽기) may sound.
  readonly unlock = () => this.deps.player.unlock();

  // original: the text shown when a translation is there too (원문 보기). remake: read it anew in place of the one kept.
  play(chat: string, message: string, version: string, { original = false, remake = false }: { original?: boolean; remake?: boolean } = {}) {
    if (this.closed) return;
    this.stop();
    const abort = new AbortController();
    this.current = { message, abort };
    this.state.put(message, { chat, version, making: true, playing: false, failure: null });
    const lease = this.deps.store.retainChat(chat);
    void lease.ready
      .then(async (failure) => (failure ? { kind: 'unsaved' as const, failure } : this.run(chat, message, version, original, remake, abort.signal)))
      .then(
        (outcome) => {
          if (this.current?.abort === abort) this.current = null;
          noteStep(`speech:${outcome?.kind ?? 'done'}`);
          this.state.put(message, outcome && outcome.kind !== 'stopped' ? { chat, version, making: false, playing: false, failure: outcome } : null);
        },
        (error: unknown) => {
          this.state.put(message, null);
          throw error;
        },
      )
      .finally(() => lease.release());
  }

  stop() {
    this.current?.abort.abort();
    this.current = null;
  }

  // 닫기 on a failure.
  dismiss(message: string) {
    const reading = this.state.snapshot().get(message);
    if (reading?.failure) this.state.put(message, null);
  }

  close() {
    this.closed = true;
    this.stop();
  }

  private update(message: string, change: Partial<Reading>) {
    const reading = this.state.snapshot().get(message);
    if (reading) this.state.put(message, { ...reading, ...change });
  }

  private async run(chat: string, message: string, version: string, original: boolean, remake: boolean, signal: AbortSignal): Promise<SpeechFailure | Stopped | null> {
    const { store, read } = this.deps;
    const view = await read.displayed(chat);
    if (signal.aborted) return STOPPED;
    const index = view?.messages.findIndex(({ id }) => id === message) ?? -1;
    const shownVersion = index === -1 ? null : shown(view!.messages[index]!);
    if (!view || !shownVersion || shownVersion.id !== version) return { kind: 'gone' };
    const of: Speech['of'] = shownVersion.translation && !original ? 'translation' : 'text';
    const held = store.children('speech', chat).find(({ value }) => value.version === version && value.of === of);
    if (held && !remake) return this.playKept(message, held.value, signal);
    const switches = chatSpeech(store, view.chat);
    const route = speechRoute(store, switches.model);
    if ('kind' in route) return route;
    if (!switches.voice || switches.voice.connection !== route.connection.id) return { kind: 'no-voice' };
    const shownText = of === 'translation' ? translationShown(store, view.chat)(shownVersion.translation!.text) : view.display.texts[index]!;
    const text = speechText(shownText, switches.quotes);
    if (!text) return { kind: 'empty', quotes: switches.quotes };
    const made = await this.speak(message, route, switches.voice.id, speechParts(text, route.speaks.most(route.model)), signal);
    if ('kind' in made) return made;
    // A reading the listener did not hear to its end is not kept: its later stretches were never read.
    if (!made.whole) return this.after(await made.playing);
    const joined = joinAudio(made.parts);
    if (!joined) {
      const played = await made.playing;
      return played === 'ended' ? { kind: 'unjoined' } : this.after(played);
    }
    const saved = await this.deps.files.save([joined.bytes], { signal });
    if (!saved.ok) return saved.error === 'stopped' ? STOPPED : { kind: 'unsaved', failure: saved };
    const file = saved.data[0];
    if (!file) return { kind: 'file-refused' };
    const value: Speech = { message, version, of, file, type: joined.type, size: joined.bytes.byteLength, at: Date.now() };
    const written = held ? await store.update('speech', held.id, () => value) : await store.create('speech', value, { parent: chat });
    if (!written.ok) return { kind: 'unsaved', failure: written };
    return this.after(await made.playing);
  }

  private after(played: Played): SpeechFailure | Stopped | null {
    return played === 'ended' ? null : played === 'stopped' ? STOPPED : { kind: played };
  }

  private async playKept(message: string, speech: Speech, signal: AbortSignal): Promise<SpeechFailure | Stopped | null> {
    const bytes = await this.deps.files.read(speech.file, { signal });
    if (!bytes.ok) return bytes.error === 'stopped' ? STOPPED : { kind: 'unsaved', failure: bytes };
    this.update(message, { making: false, playing: true });
    return this.after(await this.deps.player.play({ bytes: bytes.data, type: speech.type }, signal));
  }

  // Each stretch is read from the provider in turn and sounds as soon as the one before it has ended.
  // whole: every stretch was read; a play that did not end (blocked, unplayable) stops the reading of the rest.
  private async speak(message: string, { connection, model, speaks }: SpeechRoute, voice: string, texts: string[], signal: AbortSignal): Promise<SpeechFailure | Stopped | { parts: Spoken[]; whole: boolean; playing: Promise<Played> }> {
    const held = await this.deps.credentials.use(connection.value, signal);
    if (!held.ok) return held.failure.kind === 'stopped' ? STOPPED : { kind: 'unspoken', error: held.failure };
    const parts: Spoken[] = [];
    let heard: Promise<Played> = Promise.resolve('ended');
    let halted = false;
    for (const text of texts) {
      if (halted) break;
      const request = speaks.request({ model, voice, text });
      const answer = await relayBytes({ ...request, headers: { ...request.headers, ...speaks.authHeaders(held.credential) } }, signal, callLabel('speech', connection.value, model.id), held.resolved.type);
      if (!answer.ok) {
        if (answer.failure.kind === 'stopped') return STOPPED;
        held.stale();
        return { kind: 'unspoken', error: answer.failure };
      }
      const part = speaks.parse(answer.bytes, answer.type);
      if (!part) return { kind: 'not-audio' };
      parts.push(part);
      heard = heard.then(async (before) => {
        if (before !== 'ended') return before;
        this.update(message, { playing: true });
        const played = await this.deps.player.play(part, signal);
        if (played !== 'ended') halted = true;
        return played;
      });
    }
    this.update(message, { making: false });
    return { parts, whole: !halted, playing: heard };
  }
}
