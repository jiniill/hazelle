import { expect, it } from 'vitest';
import type { Stored } from '../../model/kinds';
import { byLastUse, groupPrompts } from './promptCopies';

const prompt = (id: string, name: string, origin?: string): Stored<'prompt'> => ({
  id, kind: 'prompt', parent: null, rev: 1,
  value: { name, blocks: [], toggles: [], authorNote: '', models: {}, ...(origin === undefined ? {} : { origin: { id: origin, name: '원본' } }) },
});
const ids = (prompts: readonly Stored<'prompt'>[]) => prompts.map(({ id }) => id);

it('stands a prompt’s copies under it by name, and places the unused last by name', () => {
  const prompts = [prompt('b', '나'), prompt('z', '다', 'root'), prompt('a', '가'), prompt('old', '오래'), prompt('root', '원본'), prompt('a2', '가', 'root'), prompt('a1', '가', 'root')];
  const uses = new Map([['old', { chats: 1, at: 10 }], ['z', { chats: 1, at: 20 }]]);
  const { top, copies } = groupPrompts(prompts);
  expect(ids(copies.get('root')!)).toEqual(['a2', 'a1', 'z']);
  expect(ids(top.toSorted(byLastUse(uses, copies)))).toEqual(['root', 'old', 'a', 'b']);
});
