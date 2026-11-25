import { bareModel } from './chat-completions';
import { CONNECTOR_MODELS } from './models-dev';
import type { ConnectionType, Meter, Model, Voice } from './types';
import { count } from './values';
import { isRecord } from '../record';

const API = 'https://api.elevenlabs.io';

const speaking = (id: string, name: string): Model => ({ ...bareModel(id), name, input: ['text'], output: ['audio'] });
const MODELS: Model[] = CONNECTOR_MODELS.elevenlabs.map(({ id, name }) => speaking(id, name));

// Characters per request, as the models page states them (elevenlabs.io/docs/models, 2026-11-25).
const MOST: Partial<Record<string, number>> = { eleven_v3: 5_000, eleven_multilingual_v2: 10_000, eleven_flash_v2_5: 40_000 };

const key = (secret: string) => ({ 'xi-api-key': secret });

function voiceOf(raw: unknown): Voice[] {
  if (!isRecord(raw) || typeof raw.voice_id !== 'string' || typeof raw.name !== 'string') return [];
  const labels = isRecord(raw.labels) ? Object.values(raw.labels).filter((label): label is string => typeof label === 'string' && label !== '') : [];
  const about = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : labels.join(' · ') || null;
  return [{ id: raw.voice_id, name: raw.name, about }];
}

const subscription = (secret: string) => ({ url: `${API}/v1/user/subscription`, method: 'GET' as const, headers: key(secret), body: null });

function meters(payload: unknown): Meter[] | null {
  if (!isRecord(payload)) return null;
  const used = count(payload.character_count);
  const limit = count(payload.character_limit);
  if (used === null || limit === null) return [];
  // A free account's names one long past (2026-11-25), which is no reset to come.
  const reset = count(payload.next_character_count_reset_unix);
  const at = reset === null ? null : reset * 1000;
  return [{ kind: 'left', label: '크레딧', unit: 'credit', amount: Math.max(limit - used, 0), limit, resets: at === null || at <= Date.now() ? null : { at } }];
}

export const elevenlabs: ConnectionType = {
  browser: {},
  id: 'elevenlabs',
  label: 'ElevenLabs',
  group: 'maker',
  description: '캐릭터의 목소리로 메시지를 읽어요.',
  keyPage: 'https://elevenlabs.io/app/settings/api-keys',
  detect: { key: /^sk_[0-9a-f]{48}$/, host: 'api.elevenlabs.io' },
  models: MODELS,
  // The only check that a pasted key works: the model list is not asked for.
  meters: [{ request: subscription, parse: meters, plan: (payload) => (isRecord(payload) && typeof payload.tier === 'string' ? payload.tier : null) }],
  speaks: {
    models: MODELS,
    most: (model) => MOST[model.id] ?? 5_000,
    voices: {
      request: (secret, after) => ({ url: `${API}/v2/voices?page_size=100${after === null ? '' : `&next_page_token=${encodeURIComponent(after)}`}`, method: 'GET', headers: key(secret), body: null }),
      parse(payload) {
        if (!isRecord(payload) || !Array.isArray(payload.voices)) return null;
        const next = payload.has_more === true && typeof payload.next_page_token === 'string' ? payload.next_page_token : null;
        return { voices: payload.voices.flatMap(voiceOf), next };
      },
    },
    // 64 kbps: speech loses nothing a listener hears, and a minute stays near half a megabyte in the picture budget.
    request: ({ model, voice, text }) => ({
      url: `${API}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: model.id }),
    }),
    authHeaders: key,
    parse: (bytes, type) => (bytes.byteLength > 0 && type?.startsWith('audio/') ? { bytes, type: 'audio/mpeg' } : null),
  },
};
