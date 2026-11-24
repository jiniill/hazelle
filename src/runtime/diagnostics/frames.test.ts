import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { frameFacts, slowness } from './frames';

beforeEach(() => vi.stubGlobal('location', { origin: 'https://hazelle.app' }));
afterEach(() => vi.unstubAllGlobals());

const script = { duration: 100, forcedStyleAndLayoutDuration: 10, invokerType: 'event-listener', sourceURL: 'https://hazelle.app/assets/ChatScreen-AbC1.js', sourceCharPosition: 4821 };

it('names a frame\'s longest script by its place in the app\'s own bundle, and one from elsewhere by nothing', () => {
  const frame = { startTime: 1000, duration: 2400.4, blockingDuration: 2350, renderStart: 3000, scripts: [script, { ...script, duration: 1800, forcedStyleAndLayoutDuration: 900, invokerType: 'user-callback', sourceCharPosition: 77 }] };
  expect(frameFacts(frame, 2600)).toEqual({ ms: 2400, blocked: 2350, script: 1900, forced: 910, render: 400, scripts: 2, own: true, place: 'ChatScreen-AbC1.js:77', invoker: 'user-callback', recent: 2600 });
  const foreign = { ...frame, scripts: [{ ...script, sourceURL: 'chrome-extension://secret/translate.js', invokerType: 'SECRET#id.onclick' }] };
  expect(frameFacts(foreign, 0)).toMatchObject({ own: false, place: null, invoker: null });
  // Another site's file under the same path is not the app's either.
  expect(frameFacts({ ...frame, scripts: [{ ...script, sourceURL: 'https://plugin.example/assets/secret-name.js' }] }, 0)).toMatchObject({ own: false, place: null });
  expect(frameFacts({ ...frame, renderStart: 0, scripts: [] }, 0)).toMatchObject({ script: 0, render: 0, own: null, place: null, invoker: null });
});

it('calls a page frozen by one long frame and janky by the blocking of many short ones', () => {
  expect(slowness(2000, 0)).toBe('frozen');
  expect(slowness(300, 3000)).toBe('janky');
  expect(slowness(300, 2999)).toBeNull();
});
