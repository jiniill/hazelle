import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { holdAccount } from './api';
import { autoDiagnose, deviceFacts, errorFacts, holdDiagnosis, sharesDiagnosis } from './auto-diagnosis';
import { markSelfHost } from './installation';

const sent = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));
beforeEach(() => {
  sent.mockClear();
  vi.stubGlobal('fetch', sent);
});
afterEach(() => {
  holdDiagnosis(false);
  holdAccount(null);
  markSelfHost(false);
  vi.unstubAllGlobals();
});

it('sends nothing unless armed, once a page per problem and chat', () => {
  autoDiagnose({ event: 'worker-trouble' });
  expect(sent).not.toHaveBeenCalled();
  holdDiagnosis(true);
  autoDiagnose({ event: 'worker-trouble' });
  autoDiagnose({ event: 'worker-trouble' });
  expect(sent).toHaveBeenCalledTimes(1);
});

it('says nothing of the account: no cookie, no account header', () => {
  holdAccount('account-id');
  holdDiagnosis(true);
  autoDiagnose({ event: 'turn-failed', detail: 'unsent' });
  const [path, init] = sent.mock.calls[0]!;
  expect(path).toBe('/api/diagnoses');
  expect(init.credentials).toBe('omit');
  expect(JSON.stringify(init)).not.toContain('account-id');
});

it('goes by the switch, and never from a self-host', () => {
  expect(sharesDiagnosis(undefined)).toBe(true);
  expect(sharesDiagnosis({ diagnosis: false } as never)).toBe(false);
  markSelfHost(true);
  expect(sharesDiagnosis(undefined)).toBe(false);
});

it('takes an error\'s name and bundle position, never its message or a function name', () => {
  const error = new TypeError('비밀 메시지');
  error.stack = 'TypeError: 비밀 메시지\n    at secretFn (https://hazelle.app/assets/index-AbC123.js:1:2345)';
  expect(errorFacts(error)).toEqual({ detail: 'TypeError', place: 'index-AbC123.js:1:2345' });
  expect(errorFacts(Object.assign(new Error('x'), { name: 'PluginBoom', stack: 'no frames' }))).toEqual({ detail: 'other', place: null });
});

it('reduces a browser to its family, major version and system', () => {
  expect(deviceFacts('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toEqual({ browser: 'chrome', major: 141, os: 'windows', mobile: false });
  expect(deviceFacts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'safari', major: 18, os: 'ios', mobile: true });
});
