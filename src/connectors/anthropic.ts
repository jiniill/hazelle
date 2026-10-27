import { VERSION } from './anthropic-messages';
import { errorValue } from './errors';
import type { BatchAnswer, Batches, ConnectionType } from './types';
import { isRecord } from './values';

// Message Batches results are JSONL at the batch's results URL (platform.claude.com batch guide, 2026-10-12).
const batches: Batches = {
  submit(endpoint, _model, request, key) {
    const params = JSON.parse(request.body!) as Record<string, unknown>;
    delete params.stream;
    return { url: `${endpoint.baseUrl}/messages/batches`, method: 'POST', headers: request.headers, body: JSON.stringify({ requests: [{ custom_id: key, params }] }) };
  },
  submitted: (payload) => (isRecord(payload) && payload.type === 'message_batch' && typeof payload.id === 'string' ? payload.id : null),
  check: (endpoint, batch) => ({ url: `${endpoint.baseUrl}/messages/batches/${batch}`, method: 'GET', headers: VERSION, body: null }),
  ended: (payload) => (isRecord(payload) && payload.type === 'message_batch' ? payload.processing_status === 'ended' : null),
  results: (endpoint, batch) => ({ url: `${endpoint.baseUrl}/messages/batches/${batch}/results`, method: 'GET', headers: VERSION, body: null }),
  answer(body, key) {
    for (const line of body.split('\n')) {
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (isRecord(row) && row.custom_id === key && isRecord(row.result)) return answerOf(row.result);
    }
    return null;
  },
  cancel: (endpoint, batch) => ({ url: `${endpoint.baseUrl}/messages/batches/${batch}/cancel`, method: 'POST', headers: VERSION, body: null }),
};

function answerOf(result: Record<string, unknown>): BatchAnswer | null {
  switch (result.type) {
    case 'succeeded':
      return { kind: 'reply', payload: result.message };
    case 'errored':
      return { kind: 'failed', detail: (isRecord(result.error) && errorValue(result.error.error)) || JSON.stringify(result.error) };
    case 'canceled':
      return { kind: 'canceled' };
    case 'expired':
      return { kind: 'expired' };
    default:
      return null;
  }
}

export const anthropic: ConnectionType = {
  browser: { headers: { 'anthropic-dangerous-direct-browser-access': 'true' } },
  id: 'anthropic',
  label: 'Anthropic',
  group: 'maker',
  major: true,
  description: 'Anthropic API로 Claude를 써요.',
  keyPage: 'https://console.anthropic.com/settings/keys',
  endpoint: { baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages' },
  detect: { key: /^sk-ant-/, host: 'api.anthropic.com' },
  // Every active model takes batches, billed at half of all usage, cache reads and writes too.
  discount: { lane: 'batch', batches, accepted: true, rates: { input: 0.5, output: 0.5, cacheRead: 0.5, cacheWrite: 0.5 } },
};
