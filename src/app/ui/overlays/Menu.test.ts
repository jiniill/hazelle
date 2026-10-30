import { expect, it } from 'vitest';
import { openingStop } from './Menu';

it('passes over a search only under a finger, and keeps a field that is only typed in', () => {
  expect(openingStop(true)).toBe('input, textarea, [role^="menuitem"], button');
  expect(openingStop(false)).toBe('input:not([type="search"]), textarea, [role^="menuitem"], button');
});
