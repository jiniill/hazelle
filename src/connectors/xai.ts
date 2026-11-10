import { bareModel } from './chat-completions';
import { effortLevels } from './settings';
import type { ConnectionType, Model } from './types';
import { count, modelEntries } from './values';
import { isRecord } from '../record';

export const xai: ConnectionType = {
  browser: {},
  id: 'xai',
  label: 'xAI',
  group: 'maker',
  description: 'xAI API로 Grok을 써요.',
  keyPage: 'https://console.x.ai/team/default/api-keys',
  endpoint: { baseUrl: 'https://api.x.ai/v1', protocol: 'chat-completions' },
  embeds: null,
  detect: { key: /^xai-/, host: 'api.x.ai' },

  parseModels: (payload) =>
    modelEntries(payload)?.map((raw): Model => {
      const efforts = isRecord(raw.capabilities) ? effortLevels(raw.capabilities.reasoning_effort) : null;
      return {
        ...bareModel(raw.id),
        contextLength: count(raw.context_length),
        reasoning: efforts ? true : null,
        takes: { settings: null, reasoning: efforts && { off: efforts.none || null, levels: efforts.levels, budget: null, adaptive: null } },
      };
    }) ?? null,
};
