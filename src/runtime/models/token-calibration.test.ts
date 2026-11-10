import { unavailableCalibration } from '../../model/token-calibration';
import { expect, it } from 'vitest';
import type { Usage } from '../../connectors/types';
import { Calibration } from '../../engine/token-calibration';
import type { CallCalibration } from '../../model/token-calibration';
import { completedCalibration, TokenSnapshot, tokenProjection } from './token-calibration';

const measurement = { kind: 'measured' as const, key: 'route', at: 1, fingerprint: 'prompt', o200k: 100, messages: 2, blocks: 2, pictures: 0 };
const calibration: CallCalibration = { measurement, fit: null, retries: [], eligible: false };
const usage: Usage = { inputTokens: 150, outputTokens: 10, cachedInputTokens: 80, cacheWriteInputTokens: 50, reasoningTokens: null };

it('accepts complete input even when output is length-cut, without adding cache details; excludes pictures and incomplete usage', () => {
  const outcome = { state: 'cut', cut: 'length', usage, inputComplete: true as const };
  const completed = completedCalibration(calibration, outcome);
  expect(tokenProjection(completed, usage)).toMatchObject({ reportedInput: 150, denominator: 100, ratio: 1.5 });
  for (const incomplete of [{ state: 'cut', cut: 'stopped', usage }, { state: 'cut', cut: 'no-terminal', usage }, { state: 'failed', cut: null, usage }, { state: 'done', cut: null, usage: null }]) expect(completedCalibration(calibration, incomplete).eligible).toBe(false);
  expect(completedCalibration({ ...calibration, measurement: { ...measurement, pictures: 1 } }, outcome).eligible).toBe(false);
  expect(tokenProjection(unavailableCalibration('historical'), usage)).toMatchObject({ denominator: null, unavailable: 'historical', ratio: null, source: 'unavailable', reportedInput: 150 });
});

it('refits from exact refusal counts, or halves room without inventing a count, with two retries at most', () => {
  const estimate = new Calibration().estimate('route', 'chat', 0);
  const snapshot = () => new TokenSnapshot('route', 'chat', { hard: 1000, user: 900, output: 100 }, [], estimate);
  const exact = snapshot();
  const fit = exact.refused({ actual: 1200, maximum: 1000 }, { ...measurement, at: Date.now(), o200k: 600 });
  expect(fit).toMatchObject({ source: 'chat', bound: 'user-centre' });
  expect(fit!.evidence).toBeCloseTo(1, 6);
  expect(fit!.allowance).toBeLessThan(450);
  expect(exact.retries[0]!.actual).toBe(1200);
  const unknown = snapshot();
  const first = unknown.refused({ actual: null, maximum: null }, { ...measurement, o200k: 600 })!;
  expect(first.allowance).toBe(Math.floor(Math.min(600, Math.floor(800 / estimate.centre)) / 2));
  expect(unknown.refused({ actual: null, maximum: null }, measurement)!.allowance).toBe(50);
  expect(unknown.refused({ actual: null, maximum: null }, measurement)).toBeNull();
  expect(unknown.retries.map(({ actual }) => actual)).toEqual([null, null]);
});


it('keeps a count-free retry inside the newly widened hard bound after invalidating confidence', () => {
  const at = Date.now();
  const event = { id: 'call', key: 'route', chat: 'chat', at, fingerprint: 'old', input: 150, denominator: 100 };
  const index = new Calibration();
  index.observe(event);
  const snapshot = new TokenSnapshot('route', 'chat', { hard: 1000, user: null, output: 100 }, [event], index.estimate('route', 'chat', at));
  const fit = snapshot.refused({ actual: null, maximum: null }, { ...measurement, at, o200k: 500 });
  expect(fit).toMatchObject({ source: 'drift-reset', evidence: 0, bound: 'hard-upper' });
  expect(fit!.allowance).toBeLessThan(250);
});
