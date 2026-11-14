import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MemoryFields, MemorySplit } from './MemoryFields';

// Static markup opens no ⓘ, and a closed fold draws no rows: the ⓘ is left out and the fold stands open.
vi.mock('../ui/overlays/Hint', () => ({ Hint: () => null }));
vi.mock('../ui', async (original) => ({ ...(await original<typeof import('../ui')>()), Disclosure: ({ children }: { children: ReactNode }) => children }));

const part = (tokens: number) => ({ tokens, value: `${tokens}` });

it('names the total only when one is given', () => {
  const split = (total?: string) => renderToStaticMarkup(<MemorySplit total={total} whole={61_000} records={part(1_000)} waiting={part(12_000)} recent={part(24_000)} />);
  expect(split('약 37,000 / 61,000 토큰')).toContain('요청마다 보내는 기록과 대화');
  expect(split('약 37,000 / 61,000 토큰')).toContain('약 37,000 / 61,000 토큰');
  expect(split()).not.toContain('요청마다 보내는 기록과 대화');
});

it('names each setting as its part of the split, in the order of the split', () => {
  const split = renderToStaticMarkup(<MemorySplit whole={61_000} records={part(1_000)} waiting={part(12_000)} recent={part(24_000)} />);
  const fields = renderToStaticMarkup(<MemoryFields value={{ on: true, budget: 25_000, window: 24_000, batch: 12_000 }} onChange={() => {}} />);
  const labels = [...split.matchAll(/<dt[^>]*>([^<]+)</g)].map((match) => match[1]!);
  expect(labels).toEqual(['기록', '정리 대기 중인 대화', '원문으로 보낼 최근 대화']);
  const places = labels.map((label) => fields.indexOf(`aria-label="${label}"`));
  expect(places.every((place) => place >= 0)).toBe(true);
  expect(places).toEqual([...places].sort((a, b) => a - b));
});
