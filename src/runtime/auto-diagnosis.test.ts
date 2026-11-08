import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EMPTY_SETTINGS } from '../model/settings';
import { holdAccount } from './api';
import { autoDiagnose, deviceFacts, errorFacts, holdDiagnosis, sharesDiagnosis } from './auto-diagnosis';
import { markSelfHost } from './installation';

const sent = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));
beforeEach(() => {
  sent.mockClear();
  vi.stubGlobal('fetch', sent);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0', onLine: true, language: 'ko-KR', hardwareConcurrency: 8 });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
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
  expect(sharesDiagnosis(EMPTY_SETTINGS)).toBe(true);
  expect(sharesDiagnosis({ ...EMPTY_SETTINGS, diagnosis: false })).toBe(false);
  markSelfHost(true);
  expect(sharesDiagnosis(EMPTY_SETTINGS)).toBe(false);
});

it('takes an error\'s name and bundle position, never its message or a function name', () => {
  const error = new TypeError('비밀 메시지');
  error.stack = 'TypeError: 비밀 메시지\n    at secretFn (https://hazelle.app/assets/index-AbC123.js:1:2345)';
  expect(errorFacts(error)).toEqual({ detail: 'TypeError', cause: 'other', place: 'index-AbC123.js:1:2345', frames: 'index-AbC123.js:1:2345' });
  error.stack += '\n    at caller (https://hazelle.app/assets/Workspace-x.js:8:9)';
  expect(errorFacts(error).frames).toBe('index-AbC123.js:1:2345 Workspace-x.js:8:9');
  expect(errorFacts(Object.assign(new Error('x'), { name: 'PluginBoom', stack: 'no frames' }))).toEqual({ detail: 'other', cause: 'other', place: null, frames: null });
});

it('classifies only whole fixed browser messages, including errors with no stack', () => {
  const facts = (message: unknown) => errorFacts({ name: 'TypeError', message });
  expect(facts('Load failed')).toEqual({ detail: 'TypeError', cause: 'fetch', place: null, frames: null });
  expect(facts('Failed to fetch').cause).toBe('fetch');
  expect(facts('NetworkError when attempting to fetch resource.').cause).toBe('fetch');
  expect(facts('Importing a module script failed.').cause).toBe('module-import');
  expect(facts('Importing a module script is canceled.').cause).toBe('module-import');
  for (const message of ['Load failed: private text', ' Load failed', 'Load failed\n', 'Failed to fetch dynamically imported module: https://private.example/', 'load failed', undefined, { toString: () => 'Load failed' }]) {
    expect(facts(message).cause).toBe('other');
  }
});

it('sends distinct stackless causes once each without their messages, and drops a 400 without retry', async () => {
  sent.mockResolvedValueOnce(new Response(null, { status: 400 }));
  holdDiagnosis(true);
  for (const message of ['Load failed', 'Load failed', 'Importing a module script failed.', 'private text']) {
    autoDiagnose({ event: 'app-error', origin: 'rejection', ...errorFacts({ name: 'TypeError', message }) });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const bodies = sent.mock.calls.map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>);
  expect(bodies.map(({ cause }) => cause)).toEqual(['fetch', 'module-import', 'other']);
  expect(bodies.every((body) => body.origin === 'rejection' && body.place === null && body.frames === null && !Object.hasOwn(body, 'message'))).toBe(true);
  expect(JSON.stringify(bodies)).not.toMatch(/Load failed|Importing a module script failed|private text/);
});

it('reduces a browser to its family, major version and system', () => {
  expect(deviceFacts('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toEqual({ browser: 'chrome', major: 141, os: 'windows', mobile: false });
  expect(deviceFacts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'safari', major: 18, os: 'ios', mobile: true });
});
