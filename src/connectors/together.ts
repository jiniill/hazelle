import { bareModel } from './chat-completions';
import type { ConnectionType } from './types';
import { count, nameOf } from './values';
import { isRecord } from '../record';

export const together: ConnectionType = {
  browser: {},
  id: 'together',
  label: 'Together AI',
  group: 'gateway',
  description: '여러 회사의 공개 모델을 Together 서버에서 실행해요.',
  keyPage: 'https://api.together.ai/settings/projects/~current/api-keys',
  endpoint: { baseUrl: 'https://api.together.ai/v1', protocol: 'chat-completions' },
  embeds: null,
  detect: { key: null, host: 'api.together.ai' },

  // GET /models answers a bare array, not the standard { data } list, and it holds image, embedding and rerank models
  // too; only type chat chats.
  parseModels: (payload) =>
    Array.isArray(payload)
      ? payload
          .filter((raw): raw is Record<string, unknown> & { id: string } => isRecord(raw) && raw.type === 'chat' && typeof raw.id === 'string' && raw.id !== '')
          .map((raw) => ({ ...bareModel(raw.id), name: nameOf(raw, 'display_name'), contextLength: count(raw.context_length) }))
      : null,
};
