import { expect, it } from 'vitest';
import { badgesOf } from './tool';

it('reads the keyless toolchat row as the host badges and a keyed row as none', () => {
  const badges = { m1: { version: 'v1', text: '요약됨' } };
  expect(badgesOf({ module: 'tool', key: null, value: badges })).toBe(badges);
  expect(badgesOf({ module: 'tool', key: 'count', value: badges })).toBeNull();
});
