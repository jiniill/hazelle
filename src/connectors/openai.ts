import type { ConnectionType } from './types';

export const openai: ConnectionType = {
  browser: {},
  id: 'openai',
  label: 'OpenAI',
  group: 'maker',
  major: true,
  description: 'OpenAI API로 GPT를 써요.',
  keyPage: 'https://platform.openai.com/api-keys',
  endpoint: { baseUrl: 'https://api.openai.com/v1', protocol: 'chat-completions' },
  detect: { key: /^sk-proj-/, host: 'api.openai.com' },
  outputLimit: (tokens) => ({ max_completion_tokens: tokens }),
  // Flex halves all rates, including cache. Model eligibility stays unknown; price only the reported tier.
  // Capacity and account limits both use 429; distinguish their codes (OpenAI flex/pricing guides, 2026-10-12).
  // Unverified against a live refusal.
  discount: {
    lane: 'tier',
    fields: { service_tier: 'flex' },
    served: 'flex',
    busy: (status, code) => status === 429 && code !== 'rate_limit_exceeded' && code !== 'insufficient_quota',
    accepted: null,
    rates: { input: 0.5, output: 0.5, cacheRead: 0.5, cacheWrite: 0.5 },
  },
};
