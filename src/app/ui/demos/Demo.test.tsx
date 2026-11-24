import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { expect, it, vi } from 'vitest';
import { Demo, nextRound } from './Demo';

const loaded = vi.hoisted(() => ({ drawing: false }));
vi.mock('../foundation/media', async (actual) => ({ ...(await actual()), useReducedMotion: () => false }));
vi.mock('./ReplyDemos', async (actual) => {
  loaded.drawing = true;
  return actual();
});

it('alternates a demo of two ways each round until one is picked, then replays the picked one', () => {
  const start = { way: 0 as const, held: false, count: 0 };
  expect(nextRound(start, true)).toEqual({ way: 1, held: false, count: 1 });
  expect(nextRound({ ...start, held: true }, true)).toEqual({ way: 0, held: true, count: 1 });
  expect(nextRound(start, false)).toEqual({ way: 0, held: false, count: 1 });
});

it('loads the drawings apart from the kit, with the first demo drawn', async () => {
  expect(loaded.drawing).toBe(false);
  const { prelude } = await prerender(<Demo label="응답 잉크" name="ink" />);
  expect(loaded.drawing).toBe(true);
  const { Drawing } = await import('./drawings');
  expect(await new Response(prelude).text()).toContain(renderToStaticMarkup(<Drawing name="ink" way={0} />));
});
