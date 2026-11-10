import { bareModel, listedSettings } from './chat-completions';
import { effortLevels, type ReasoningTakes } from './settings';
import { statedPrice } from './pricing';
import type { Rates } from './models-dev';
import type { ConnectionType, Modality } from './types';
import { amount, count, decimal, modelEntries, nameOf, perMillion } from './values';
import { isRecord } from '../record';

const API = 'https://ai-gateway.vercel.sh/v1';

// Vercel names a PDF input where the other catalogs say file.
const MODALITIES: Partial<Record<string, Modality>> = { text: 'text', image: 'image', audio: 'audio', video: 'video', pdf: 'file' };

function modalities(value: unknown): Modality[] | null {
  return Array.isArray(value) ? [...new Set(value.map((item) => MODALITIES[String(item)]).filter((item) => item !== undefined))] : null;
}

// reasoning_options names every control a model has, so one it leaves out is not there; a model
// without the list has controls the catalog does not describe.
function reasoningTakes(options: unknown[]): ReasoningTakes {
  const listed = options.filter(isRecord);
  const efforts = effortLevels(listed.find((option) => option.type === 'effort')?.values);
  const budget = listed.find((option) => option.type === 'budget_tokens');
  return {
    off: listed.some((option) => option.type === 'toggle') || efforts?.none === true,
    levels: efforts?.levels ?? [],
    budget: budget ? { min: count(budget.min), max: count(budget.max) } : false,
    adaptive: null,
  };
}

// A model priced by tiers is left to models.dev, which states them by context size as this app reads them. An embedding
// model is priced by its input alone: it writes nothing.
function price(value: unknown, embeds: boolean): Rates | undefined {
  if (!isRecord(value) || Object.keys(value).some((field) => field.endsWith('_tiers'))) return undefined;
  return statedPrice(perMillion(value.input), embeds ? 0 : perMillion(value.output), perMillion(value.input_cache_read), perMillion(value.input_cache_write));
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

export const vercel: ConnectionType = {
  browser: {},
  id: 'vercel',
  label: 'Vercel AI Gateway',
  group: 'gateway',
  description: '여러 회사의 모델을 키 하나로 써요. 잔액도 볼 수 있어요.',
  keyPage: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys',
  endpoint: { baseUrl: API, protocol: 'chat-completions' },
  detect: { key: /^vck_/, host: 'ai-gateway.vercel.sh' },

  // The list also holds image, video and speech models; only language models chat, and embedding models embed.
  parseModels(payload) {
    const entries = modelEntries(payload);
    if (!entries) return null;
    return entries
      .filter((raw) => raw.type === 'language' || raw.type === 'embedding')
      .map((raw) => {
        const embeds = raw.type === 'embedding';
        const kinds = isRecord(raw.modalities) ? raw.modalities : {};
        const tags = Array.isArray(raw.tags) ? raw.tags : null;
        return {
          ...bareModel(raw.id),
          name: nameOf(raw, 'name'),
          input: modalities(kinds.input),
          output: embeds ? ['embedding' as const] : modalities(kinds.output),
          contextLength: count(raw.context_window),
          maxOutput: count(raw.max_tokens),
          reasoning: tags ? tags.includes('reasoning') : null,
          tools: tags ? tags.includes('tool-use') : null,
          takes: {
            settings: Array.isArray(raw.supported_parameters) ? listedSettings(raw.supported_parameters) : null,
            reasoning: Array.isArray(raw.reasoning_options) ? reasoningTakes(raw.reasoning_options) : null,
          },
          price: price(raw.pricing, embeds),
        };
      });
  },

  reasoningBudget: (tokens) => ({ reasoning: { max_tokens: tokens } }),

  // The team's credits, not the key's: every key of a team draws on one balance.
  meters: [{
    request: (secret) => ({ url: `${API}/credits`, method: 'GET', headers: bearer(secret), body: null }),
    parse(payload) {
      if (!isRecord(payload)) return null;
      const balance = decimal(payload.balance);
      const used = decimal(payload.total_used);
      return [
        ...(balance === null ? [] : [{ kind: 'left' as const, label: '잔액', unit: 'usd' as const, amount: balance, limit: null, resets: null }]),
        ...(used === null ? [] : [{ kind: 'spent' as const, label: '총 사용 금액', unit: 'usd' as const, amount: used }]),
      ];
    },
  }],

  // Each stream event carries the generation id (gen_…) as its id.
  settle: {
    request: (secret, id) => ({ url: `${API}/generation?id=${encodeURIComponent(id)}`, method: 'GET', headers: bearer(secret), body: null }),
    parse(payload) {
      const cost = isRecord(payload) && isRecord(payload.data) ? amount(payload.data.total_cost) : null;
      return cost === null ? null : { unit: 'usd', amount: cost, source: 'reported' };
    },
  },
};
