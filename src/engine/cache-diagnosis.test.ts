import { expect, it } from 'vitest';
import type { CacheComparison, ForecastPart } from '../model/cache';
import { cacheDiagnosis, cacheTags } from './cache-diagnosis';
import type { CbsTrace } from './cbs/evaluate';
import type { Assembled } from './pipeline';
import type { ChatScope } from './render';

const scope: ChatScope = { card: null, cast: [], packs: [], persona: null, prompt: null, note: null, lore: [], loreFolders: {}, loreScan: { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false }, messages: [], variables: [], greeting: null, toggles: new Map(), model: null, axModel: null, clock: { now: Date.UTC(2026, 9, 24, 12, 3), timeZone: 'UTC' }, assets: [], inlays: [], textfiles: [], modules: [], faces: { char: null, user: null }, screen: null, pick: '' };
const from = { kind: 'block', id: 'clock', name: 'Clock', slot: null } as const;
const part: ForecastPart = { from, role: 'system', tokens: 10, state: 'write', change: 'changed', before: 0, point: 'cache' };
const prompt = (content: string, parts: Assembled['parts'] = [{ from, tokens: 10 }]): Assembled => ({ messages: [{ role: 'system', content }], parts, lore: [], silent: [], invalidKeys: [], loreBudget: 0, memory: null, dropped: 0, problems: { found: [], omitted: 0 }, unseen: 0 });
const comparison = (before: Assembled, after: Assembled): CacheComparison => ({ forecast: { parts: [part], removed: [], written: 10, tail: 0, against: { read: 0, of: 10, broken: { kind: 'changed', from, role: 'system' } } }, before: { prompt: before, wire: before.messages.map(({ content }, index) => ({ content, index })) }, after: { prompt: after, wire: after.messages.map(({ content }, index) => ({ content, index })) } });

it('names a CBS result only when the changed renders explain the whole sent difference and the old value is exactly aligned', () => {
  const source = 'Time {{time}}.';
  const before = prompt('Time 12:1:0.', [{ from, tokens: 10, cbs: [{ place: 'clock', text: source, rendered: 'Time 12:1:0.', seed: 'old' }] }]);
  const after = prompt('Time 12:3:0.', [{ from, tokens: 10, cbs: [{ place: 'clock', text: source, rendered: 'Time 12:3:0.', seed: 'new' }] }]);
  const input = comparison(before, after);
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toEqual([{ kind: 'tag', tag: '{{time}}', before: '12:1:0', after: '12:3:0' }]);
  input.after.wire[0]!.content += ' script';
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toEqual([{ kind: 'unknown' }]);
  const framed = (time: string, seed: string) => prompt(`[Char]\nTold.\n\nTime ${time}.`, [{ from, tokens: 10, cbs: [{ place: 'clock:told', text: 'Told.', rendered: 'Told.', seed }, { place: 'clock:own', text: source, rendered: `Time ${time}.`, seed }] }]);
  expect(cacheDiagnosis(comparison(framed('12:1:0', 'old'), framed('12:3:0', 'new')), scope).parts[0]!.causes).toEqual([{ kind: 'tag', tag: '{{time}}', before: '12:1:0', after: '12:3:0' }]);
});

it('refuses erased, omitted, truncated or ambiguously aligned tag evidence', () => {
  const source = '{{x}} / {{y}}';
  const trace: CbsTrace = { omitted: 0, steps: [{ at: 0, end: 5, depth: 0, result: 'new' }, { at: 8, end: 13, depth: 0, result: 'end' }] };
  expect(cacheTags('old / tail', 'new / end', source, trace)).toHaveLength(2);
  expect(cacheTags('old / old / tail', 'new / end', source, trace)).toEqual([]);
  trace.steps[0]!.erased = true;
  expect(cacheTags('old / tail', 'new / end', source, trace)).toEqual([]);
  delete trace.steps[0]!.erased;
  trace.omitted = 1;
  expect(cacheTags('old / tail', 'new / end', source, trace)).toEqual([]);
  trace.omitted = 0;
  trace.steps[0]!.result = 'x'.repeat(1000);
  trace.steps[0]!.truncated = true;
  expect(cacheTags('old / tail', `${trace.steps[0]!.result} / end`, source, trace)).toEqual([]);
});

it('keeps lore firing evidence and known positions when wire text is unavailable', () => {
  const depth = { kind: 'depth', id: 'entry', name: 'Entry', depth: 1 } as const;
  const old = prompt('old');
  old.silent = [{ id: 'entry', name: 'Entry', why: { kind: 'unmatched' } }];
  const next = prompt('new');
  next.lore = [{ id: 'entry', name: 'Entry', why: { kind: 'keys', matched: [] }, fate: { kind: 'placed', tokens: 10 } }];
  const input = comparison(old, next);
  input.before = { prompt: old };
  input.forecast.parts = [{ ...part, from: depth, before: 2 }];
  input.after.wire[0]!.index = 3;
  expect(cacheDiagnosis(input, scope)).toMatchObject({ missing: 1, parts: [{ diff: null, causes: [
    { kind: 'lore', before: { fired: false, why: { kind: 'unmatched' } }, after: { fired: true } },
    { kind: 'hoisted', wire: 0, prompt: 3 },
  ] }] });
  input.forecast.parts[0]!.change = 'moved';
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toMatchObject([{ kind: 'lore' }, { kind: 'moved', before: 2, after: 0, depth: 1 }]);
  input.before = null;
  input.forecast.parts[0] = { ...part };
  input.after.wire[0]!.index = 0;
  expect(cacheDiagnosis(input, scope)).toMatchObject({ missing: 1, parts: [{ diff: null, causes: [] }] });
});

it('attributes changed chat and memory sources, not merely their wrappers or rendered values', () => {
  const chat = { kind: 'block', id: 'chat', name: null, slot: 'chat' } as const;
  const old = prompt('old', [{ from: chat, tokens: 10, origin: 'message', source: 'old' }]);
  const next = prompt('new', [{ from: chat, tokens: 10, origin: 'message', source: 'new' }]);
  const input = comparison(old, next);
  input.forecast.parts[0] = { ...part, from: chat, role: 'user' };
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toEqual([{ kind: 'edited' }]);
  next.parts[0]!.source = 'old';
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toEqual([{ kind: 'unknown' }]);
  input.forecast.parts[0]!.from = { ...chat, slot: 'memory' };
  next.parts[0]!.source = 'summary renewed';
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toEqual([{ kind: 'memory' }]);
});

it('names a newly firing entry merged into the changed lore part', () => {
  const old = prompt('base');
  old.silent = [{ id: 'merged', name: 'Merged', why: { kind: 'unmatched' } }];
  const next = prompt('base added');
  next.lore = [{ id: 'merged', name: 'Merged', why: { kind: 'keys', matched: [] }, fate: { kind: 'merged', into: 'base', tokens: 10 } }];
  const input = comparison(old, next);
  input.forecast.parts[0]!.from = { kind: 'lore', id: 'base', name: 'Base', slot: 'lorebook' };
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toMatchObject([{ kind: 'lore', id: 'merged', before: { fired: false }, after: { fired: true } }]);
});
