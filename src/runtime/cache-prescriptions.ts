import { cacheCandidates, cacheEditedLore, cacheEditedPrompt, cacheOverlay } from '../engine/cache-prescriptions';
import type { CacheDiagnosis, CacheEdit, CachePrescription, Forecast } from '../model/cache';
import type { ApiResult } from './api';
import { breakCost, forecast, type Prior } from './cache';
import { chatPrompt } from './prompts';
import type { ObjectStore } from './store';
import { cacheSend, type Sending } from './turn-context';

export async function priceCachePrescriptions(store: ObjectStore, chat: string, sending: Sending, diagnosis: CacheDiagnosis, current: Forecast, prior: Prior | null, account: string | null, signal: AbortSignal): Promise<CachePrescription[] | null> {
  if (!current.against || !prior) return [];
  const choice = chatPrompt(store, sending.turn.chat);
  const prompt = choice.kind === 'prompt' && choice.prompt.value === sending.input.scope.prompt ? choice.prompt.id : null;
  const candidates = cacheCandidates(diagnosis, current, sending.input.scope, prompt);
  const prescriptions: CachePrescription[] = [];
  try {
    // One job per distinct edit, sequential on the composer's lane, with its original clock, seed and calibration.
    for (const candidate of candidates) {
      if (signal.aborted) return null;
      const scope = cacheOverlay(sending.input.scope, candidate.edit);
      if (!scope) continue;
      const prompt = await store.evaluation.prompt({ asker: 'forecast', chat }, { ...sending.input, scope }, signal);
      if (signal.aborted) return null;
      if ('kind' in prompt) continue;
      const send = cacheSend({ ...sending, prompt }, account);
      const after = send && forecast(prior, send);
      if (!after?.against || after.against.read <= current.against.read) continue;
      const { read, of } = current.against;
      prescriptions.push({ ...candidate, before: { read, of }, after: { read: after.against.read, of: after.against.of }, cost: breakCost(sending.turn.route.connection.value, sending.turn.route.model, after, sending.calibration.estimate.centre) });
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
    : await store.update('lore', edit.id, (current) => cacheEditedLore(current, edit));
  return saved.ok ? { ok: true, data: { ...edit, before: edit.after, after: edit.before } as CacheEdit } : saved;
}
