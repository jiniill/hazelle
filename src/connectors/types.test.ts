import { expect, it } from 'vitest';
import { replyLimit } from './types';

it('reads an output limit as large as the context window as an unknown reply length', () => {
  expect(replyLimit({ contextLength: 1_000_000, maxOutput: 1_000_000 })).toBeNull();
  expect(replyLimit({ contextLength: 131_072, maxOutput: 262_144 })).toBeNull();
  expect(replyLimit({ contextLength: 1_000_000, maxOutput: 128_000 })).toBe(128_000);
  expect(replyLimit({ contextLength: null, maxOutput: 128_000 })).toBe(128_000);
  expect(replyLimit({ contextLength: 1_000_000, maxOutput: null })).toBeNull();
});
