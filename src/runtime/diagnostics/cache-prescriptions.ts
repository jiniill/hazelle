import { cacheCandidates, cacheEditedLore, cacheEditedPrompt, cacheOverlay, cacheToggled } from '../../engine/cache-prescriptions';
import type { CacheDiagnosis, CacheEdit, CachePrescription, CacheTurn, Forecast } from '../../model/cache';
import type { ApiResult } from '../api';
import { breakCost, forecast, type Prior } from './cache';
import { SETTINGS_ID } from '../../model/settings';
import { accountSettings } from '../account-settings';
import { packsOf, togglesOf } from '../chat/chat-context';
import { chatPrompt } from '../library/prompts';
import type { ObjectStore } from '../store/store';
import { cacheSend, type Sending } from '../chat/turn-context';

// The send after this one: a reply and a message stand in for the ones to come, under the seed a new reply rolls.
const following = (input: Sending['input']): Sending['input'] => ({
  ...input,
  seed: `${input.seed}:next`,
  scope: { ...input.scope, messages: [...input.scope.messages, ...(['assistant', 'user'] as const).map((role) => ({ id: `${input.seed}:${role}`, message: `${input.seed}:${role}`, seed: `${input.seed}:${role}`, role, text: role, time: null }))] },
});

export async function priceCachePrescriptions(store: ObjectStore, chat: string, sending: Sending, diagnosis: CacheDiagnosis, current: Forecast, prior: Prior | null, account: string | null, signal: AbortSignal): Promise<CachePrescription[] | null> {
  if (!current.against || !prior) return [];
  const choice = chatPrompt(store, sending.turn.chat);
  const prompt = choice.kind === 'prompt' && !sending.input.scope.promptOut && choice.prompt.value === sending.input.scope.prompt ? choice.prompt.id : null;
  const { character } = sending.turn.chat;
  const holder = character === null ? accountSettings(store) : store.get('character', character)?.value;
  const candidates = cacheCandidates(diagnosis, current, sending.input.scope, { prompt, character, toggles: togglesOf(store, sending.turn.chat, choice, packsOf(store, sending.turn.chat)).declared, held: holder?.toggles ?? {} });
  const prescriptions: CachePrescription[] = [];
  const { connection, model } = sending.turn.route;
  const priced = (made: Forecast) => breakCost(connection.value, model, made, sending.calibration.estimate.centre);
  const turnOf = async (input: Sending['input'], sent: Sending['prompt']): Promise<CacheTurn | null> => {
    const next = await store.evaluation.prompt({ asker: 'forecast', chat }, following(input), signal);
    const first = cacheSend({ ...sending, prompt: sent }, account);
    const second = 'kind' in next ? null : cacheSend({ ...sending, prompt: next }, account);
    const made = first && second && forecast({ print: { ...first, call: '' }, live: true }, second);
    return made?.against ? { read: made.against.read, of: made.against.of, cost: priced(made) } : null;
  };
  let standing: CacheTurn | null | undefined;
  try {
    // One job per distinct edit, sequential on the composer's lane, with its original clock, seed and calibration.
    for (const candidate of candidates) {
      if (signal.aborted) return null;
      const scope = cacheOverlay(sending.input.scope, candidate.edit);
      if (!scope) continue;
      const input = { ...sending.input, scope };
      const prompt = await store.evaluation.prompt({ asker: 'forecast', chat }, input, signal);
      if (signal.aborted) return null;
      if ('kind' in prompt) continue;
      const send = cacheSend({ ...sending, prompt }, account);
      const after = send && forecast(prior, send);
      if (!after?.against) continue;
      const { read, of } = current.against;
      const price = { ...candidate, before: { read, of }, after: { read: after.against.read, of: after.against.of }, cost: priced(after) };
      if (candidate.cause !== 'moved') {
        if (after.against.read > read) prescriptions.push({ ...price, turn: null });
        continue;
      }
      standing ??= await turnOf(sending.input, sending.prompt);
      const edited = standing && await turnOf(input, prompt);
      if (signal.aborted) return null;
      if (standing && edited && edited.of - edited.read < standing.of - standing.read) prescriptions.push({ ...price, turn: { before: standing, after: edited } });
    }
    return prescriptions;
  } catch {
    return null;
  }
}

// Keep the precondition inside update: the store replays it on conflict, and undo must not overwrite a later edit.
export async function applyCacheEdit(store: ObjectStore, edit: CacheEdit): Promise<ApiResult<CacheEdit>> {
  const saved = edit.kind === 'prompt'
    ? await store.update('prompt', edit.id, (current) => cacheEditedPrompt(current, edit))
    : edit.kind === 'lore'
      ? await store.update('lore', edit.id, (current) => cacheEditedLore(current, edit))
      : edit.character === null
        ? await store.update('settings', SETTINGS_ID, (current) => cacheToggled(current, edit))
        : await store.update('character', edit.character, (current) => cacheToggled(current, edit));
  return saved.ok ? { ok: true, data: { ...edit, before: edit.after, after: edit.before } as CacheEdit } : saved;
}
