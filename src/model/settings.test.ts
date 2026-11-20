import { expect, it } from 'vitest';
import { begun, EMPTY_SETTINGS, offerAnswered, offerOpen } from './settings';

it('asks an older account once, whichever way it answers, and never one that turned the switch on or begins now', () => {
  expect(offerOpen(EMPTY_SETTINGS, 'ink')).toBe(true);
  expect(offerOpen({ ...EMPTY_SETTINGS, ink: true }, 'ink')).toBe(false);
  const taken = offerAnswered({ ...EMPTY_SETTINGS, seen: { tour: 'v1' } }, 'ink', true);
  expect(taken).toEqual({ models: {}, ink: true, seen: { tour: 'v1', offers: ['ink'] } });
  const passed = offerAnswered(EMPTY_SETTINGS, 'ink', false);
  expect(passed).toEqual({ models: {}, seen: { offers: ['ink'] } });
  expect(offerOpen(passed, 'ink')).toBe(false);
  const fresh = begun(EMPTY_SETTINGS);
  expect(fresh).toEqual({ models: {}, ink: true, seen: { offers: ['ink'] } });
  // Turned off by hand later, it is still not asked.
  expect(offerOpen({ ...fresh, ink: undefined }, 'ink')).toBe(false);
});
