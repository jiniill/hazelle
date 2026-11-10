import { translatorNoteRequest } from '../../engine/translator-note';
import { translateSwitches, translatorNotes } from '../library/characters';
import { gather } from '../models/generate';
import { writerOf } from '../models/profiles';
import type { Session } from '../session';
import { newCall, taskCall, type CallTarget } from '../models/streams';
import { translatorOf, type TranslateFailure } from './translate';
import { keepRow } from '../models/usage';

// The 전역 note and the character's are read as stored, so the caller saves what was typed before it calls.
export async function draftTranslatorNote(session: Pick<Session, 'store' | 'credentials' | 'log' | 'tokens'>, character: string, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; failure: TranslateFailure }> {
  const { store } = session;
  const translator = translatorOf(store, { title: null, character, models: {} });
  if (!translator.ok) return translator;
  const writer = writerOf(store, translator.route);
  if ('kind' in writer) return { ok: false, failure: writer };
  const messages = translatorNoteRequest(store.get('character', character)!.value.card, translateSwitches(store, character).replyLanguage, translatorNotes(store, character));
  const target: CallTarget = { id: crypto.randomUUID(), chat: null, result: crypto.randomUUID(), for: { kind: 'note', character } };
  const text = gather();
  const { answer, receipt } = await taskCall(session, writer, { messages, call: await newCall(session, writer.route, target), signal, onText: text });
  if (answer.cut === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
  if (answer.state === 'failed' || !text.value().trim()) return { ok: false, failure: { kind: 'failed', receipt } };
  await keepRow(store, receipt, Date.now(), { chat: null, character });
  return { ok: true, text: text.value().trim() };
}
