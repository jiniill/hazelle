import type { ConnectionType, Meter } from './types';
import { count, decimal } from './values';
import { isRecord } from '../record';

const QUOTAS = [['dailyInputTokens', '오늘 입력 토큰'], ['weeklyInputTokens', '이번 주 입력 토큰']] as const;

// A key without a subscription reports no quota. A counter NanoGPT could not read comes as null (degraded): it is
// left out, never shown as a full allowance. resetAt is in epoch milliseconds.
function subscription(payload: unknown): Meter[] | null {
  if (!isRecord(payload) || typeof payload.active !== 'boolean') return null;
  if (!payload.active) return [];
  const limits = isRecord(payload.limits) ? payload.limits : {};
  return QUOTAS.flatMap(([field, label]): Meter[] => {
    const raw = payload[field];
    const quota = isRecord(raw) ? raw : {};
    const left = count(quota.remaining);
    if (left === null) return [];
    const at = count(quota.resetAt);
    return [{ kind: 'left', label, unit: 'tokens', amount: left, limit: count(limits[field]), resets: at === null ? null : { at } }];
  });
}

export const nanogpt: ConnectionType = {
  browser: {},
  id: 'nanogpt',
  label: 'NanoGPT',
  group: 'gateway',
  description: '여러 회사의 모델을 NanoGPT 키 하나로 써요. 잔액도 볼 수 있어요.',
  keyPage: 'https://nano-gpt.com/api',
  // The direct API host, which its docs name for API-key requests; nano-gpt.com is the website's.
  endpoint: { baseUrl: 'https://api.nano-gpt.com/api/v1', protocol: 'chat-completions' },
  detect: { key: null, host: 'api.nano-gpt.com' },

  // Its model list answers without a key, so these calls are what check a pasted one.
  meters: [
    {
      request: (secret) => ({ url: 'https://api.nano-gpt.com/api/check-balance', method: 'POST', headers: { 'x-api-key': secret }, body: null }),
      parse(payload) {
        if (!isRecord(payload)) return null;
        const balance = decimal(payload.usd_balance);
        return balance === null ? [] : [{ kind: 'left', label: '잔액', unit: 'usd', amount: balance, limit: null, resets: null }];
      },
    },
    {
      request: (secret) => ({ url: 'https://api.nano-gpt.com/api/subscription/v1/usage', method: 'GET', headers: { 'x-api-key': secret }, body: null }),
      parse: subscription,
    },
  ],
};
