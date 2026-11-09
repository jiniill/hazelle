import { translatorNoteRequest } from '../engine/translator-note';
import { translateSwitches, translatorNotes } from './characters';
import { routeFields } from './connections';
import { gather, generate, receiptOf } from './generate';
import { modelProfile } from './profiles';
import type { Session } from './session';
import { callOf, endCall, newCall, type CallTarget } from './streams';
import { translatorOf, type TranslateFailure } from './translate';
import { keepRow } from './usage';

// The 전역 note and the character's are read as stored, so the caller saves what was typed before it calls.
export async function draftTranslatorNote({ store, credentials, log, tokens }: Pick<Session, 'store' | 'credentials' | 'log' | 'tokens'>, character: string, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; failure: TranslateFailure }> {
  const translator = translatorOf(store, { title: null, character, models: {} });
  if (!translator.ok) return translator;
  const { route } = translator;
  const profile = modelProfile(store, route.model);
  if (profile.kind === 'missing') return { ok: false, failure: { kind: 'profile-missing', own: profile.own } };
  const { settings } = profile.profile.value;
  const messages = translatorNoteRequest(store.get('character', character)!.value.card, translateSwitches(store, character).replyLanguage, translatorNotes(store, character));
  const target: CallTarget = { id: crypto.randomUUID(), chat: null, result: crypto.randomUUID(), for: { kind: 'note', character } };
  const text = gather();
  const answer = await generate({
    credentials,
    log,
    ...routeFields(store, route, settings),
    messages,
    call: await newCall({ store, tokens }, route, target),
    signal,
    onText: text,
  }).finally(() => endCall(store, target.id));
  if (answer.cut === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
  const receipt = receiptOf(callOf(route), answer);
  if (answer.state === 'failed' || !text.value().trim()) return { ok: false, failure: { kind: 'failed', receipt } };
  await keepRow(store, receipt, Date.now(), { chat: null, character });
  return { ok: true, text: text.value().trim() };
}
