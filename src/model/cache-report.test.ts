import { expect, it } from 'vitest';
import { cacheRead, cacheReport } from './cache-report';
import type { CacheNoted } from './usage';

const block = { kind: 'block' as const, id: 'b', name: '캐릭터정보2', slot: null };
const noted = (over: Partial<CacheNoted> & Pick<CacheNoted, 'forecast'>): CacheNoted => ({
  at: 10, chat: 'c1', character: 'k1', purpose: 'reply', prompt: 'p1', causes: null,
  call: { id: crypto.randomUUID(), connection: 'vertex', model: 'argon', modelName: 'Argon', source: 'Vertex AI', usage: null, cost: null },
  ...over,
});

it('splits what the cache held into read, broken by the request and missed by the provider, and ranks where each went', () => {
  const moved = { kind: 'moved' as const, from: block, role: 'system' as const };
  const report = cacheReport([
    noted({ forecast: { read: 900, of: 1000, broken: moved }, causes: [{ kind: 'moved', name: null }] }),
    noted({ forecast: { read: 800, of: 1000, broken: moved }, chat: 'c2', prompt: 'p2' }),
    noted({ forecast: { read: 0, of: 500, broken: { kind: 'expired' } }, chat: 'c2', prompt: 'p2' }),
    noted({ forecast: { read: 1000, of: 1000, broken: null }, missed: 1000 } as never),
    noted({ forecast: { read: 0, of: 0, broken: null } }),
    noted({ forecast: { read: 0, of: 700, broken: { kind: 'expired' } }, at: 1 }),
  ], 5, (one) => ('missed' in one ? 1000 : 0));
  expect(report.total).toEqual({ calls: 4, of: 3500, broken: 800, missed: 1000 });
  expect(cacheRead(report.total)).toBe(1700);
  expect(report.leaks.map(({ cause, lost, times }) => [cause.kind, lost, times])).toEqual([['expired', 500, 1], ['moved', 300, 2]]);
  expect(report.leaks[1]!.chats).toEqual([{ key: 'c2', lost: 200, times: 1 }, { key: 'c1', lost: 100, times: 1 }]);
  expect(report.prompts.map(({ key, share }) => [key, share.broken, share.of])).toEqual([['p2', 700, 1500], ['p1', 100, 2000]]);
  expect(report.providers).toMatchObject([{ model: 'argon', share: { missed: 1000, of: 3500 } }]);
  expect(report.causes).toEqual([{ kind: 'moved', name: null, lost: 100, times: 1 }]);
  expect(report.first).toBe(10);
});
