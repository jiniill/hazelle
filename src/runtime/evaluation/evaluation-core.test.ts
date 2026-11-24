import { expect, it, vi } from 'vitest';
import { COUNTED, Evaluator } from './evaluation-core';

const counted = vi.hoisted(() => vi.fn((text: string) => text.length));
vi.mock('gpt-tokenizer/encoding/o200k_base', () => ({ countTokens: counted }));

it('counts a text once for as long as newer texts leave it room', async () => {
  const evaluator = new Evaluator();
  const count = (texts: string[]) => evaluator.run({ lane: 'count', count: texts }, () => {});
  expect(await count(['a', 'bb', 'a'])).toEqual([1, 2, 1]);
  expect(await count(['bb', 'a'])).toEqual([2, 1]);
  expect(counted).toHaveBeenCalledTimes(2);
  await count(['c'.repeat(COUNTED - 2)]);
  expect(await count(['bb'])).toEqual([2]);
  expect(counted).toHaveBeenCalledTimes(3);
  expect(await count(['a'])).toEqual([1]);
  expect(counted).toHaveBeenCalledTimes(4);
});
