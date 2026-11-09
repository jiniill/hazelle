import { expect, it } from 'vitest';
import { fingerprint } from '../memory';
import { blankCard } from './card';
import { printOf } from './hazelle';

it('prints a card without additionalText as a charx written before the card kept it, and one with it apart', () => {
  const { additionalText, ...before } = blankCard('루나');
  const read = { card: { ...blankCard('루나'), additionalText }, lore: [], loreFolders: [], spec: 'v3' as const, icon: null, assets: [] };
  expect(printOf(read, '')).toBe(fingerprint([{ role: 'charx', text: JSON.stringify([{ ...before, toggles: '' }, [], [], []]) }]));
  expect(printOf({ ...read, card: { ...read.card, additionalText: 'The lamp is old.' } }, '')).not.toBe(printOf(read, ''));
});
