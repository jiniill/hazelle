import { act, createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { HeldRoute, useRoute } from './router';
import type { Route } from './routes';

afterEach(() => vi.unstubAllGlobals());

it('gives the page held behind a window the route it was opened on', async () => {
  const root = probeRoot();
  vi.stubGlobal('location', { pathname: '/settings/controls', search: '' });
  const seen: Route[] = [];
  function Probe() {
    seen.push(useRoute());
    return null;
  }
  const outside: Route = { kind: 'search', query: '' };
  await act(async () => root.render(createElement(HeldRoute.Provider, { value: outside }, createElement(Probe))));
  expect(seen.at(-1)).toBe(outside);
  await act(async () => root.render(createElement(Probe)));
  expect(seen.at(-1)?.kind).toBe('controls');
  await act(async () => root.unmount());
});
