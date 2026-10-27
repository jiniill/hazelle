import { bareModel } from './chat-completions';
import type { ConnectionType, Model } from './types';
import { count, flag, isRecord, modelEntries } from './values';

// Public list includes non-chat models. Missing feature flags stay unknown;
// context_length is the model limit, not the Basic/Premium 32K plan cap.
export const featherless: ConnectionType = {
  browser: {},
  id: 'featherless',
  label: 'Featherless',
  group: 'gateway',
  description: '공개 모델 수천 개를 월정액으로 써요.',
  keyPage: 'https://featherless.ai/account/api-keys',
  endpoint: { baseUrl: 'https://api.featherless.ai/v1', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.featherless.ai' },
  parseModels: (payload) =>
    modelEntries(payload)?.flatMap((raw): Model[] => {
      const features = isRecord(raw.features) ? raw.features : {};
      if (features.audio_output === true || features.classifier === true) return [];
      return [{
        ...bareModel(raw.id),
        input: features.image_input === true ? ['text', 'image'] : null,
        contextLength: count(raw.context_length),
        maxOutput: count(raw.max_completion_tokens),
        tools: flag(features.tool_use),
      }];
    }) ?? null,

  // Allowance counts concurrent units (1–4 per model), not requests; null limit is unlimited.
  // The public model list cannot validate credentials, so this call must.
  meters: [{
    request: (secret) => ({ url: 'https://api.featherless.ai/account/concurrency', method: 'GET', headers: { authorization: `Bearer ${secret}` }, body: null }),
    parse(payload) {
      if (!isRecord(payload)) return null;
      const limit = count(payload.limit);
      const used = count(payload.used_cost);
      return limit === null || used === null ? [] : [{ kind: 'left', label: '동시 실행 단위', unit: 'concurrency', amount: Math.max(limit - used, 0), limit, resets: null }];
    },
  }],
};
