import { afterEach, expect, it, vi } from 'vitest';
import { Lua } from '../../../engine/lua/run';
import type { Down } from './client';

vi.mock('../../../engine/lua/run', () => ({ Lua: { create: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

it('reports a failed WASM load to its job without rejecting again when that display is forgotten', async () => {
  const sent = vi.fn();
  let receive: (event: { data: Down }) => void;
  vi.stubGlobal('self', { postMessage: sent });
  vi.stubGlobal('addEventListener', (_type: string, listener: typeof receive) => { receive = listener; });
  vi.mocked(Lua.create).mockRejectedValue(new TypeError('Load failed'));
  await import('./worker');
  receive!({ data: { kind: 'check', id: 1, code: '' } });
  await vi.waitFor(() => expect(sent).toHaveBeenCalledWith({ kind: 'failed', id: 1, message: 'TypeError: Load failed' }));
  receive!({ data: { kind: 'forget-display', owner: 'chat', revision: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sent).toHaveBeenCalledTimes(1);
});
