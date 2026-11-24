import { expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ story: false }));
vi.mock('../story/Story', async (actual) => {
  loaded.story = true;
  return actual();
});

it('a dialog, which every screen can open, loads without the story renderer', async () => {
  await import('./Dialog');
  expect(loaded.story).toBe(false);
});
