import { expect, it } from 'vitest';
import type { CacheComparison, ForecastPart } from '../model/cache';
import { cacheDiagnosis, cacheTags } from './cache-diagnosis';
import type { CbsTrace } from './cbs/evaluate';
import type { Assembled } from './pipeline';
import type { ChatScope } from './render';

const scope: ChatScope = { card: null, cast: [], packs: [], persona: null, prompt: null, promptOut: false, note: null, status: { definitions: [], state: {} }, lore: [], loreFolders: {}, loreScan: { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false }, messages: [], variables: [], greeting: null, toggles: new Map(), model: null, axModel: null, clock: { now: Date.UTC(2026, 9, 24, 12, 3), timeZone: 'UTC' }, assets: [], inlays: [], textfiles: [], modules: [], faces: { char: null, user: null }, screen: null, pick: '' };
const from = { kind: 'block', id: 'clock', name: 'Clock', slot: null } as const;
const part: ForecastPart = { from, role: 'system', tokens: 10, state: 'write', again: false, change: 'changed', before: 0, point: 'cache' };
const prompt = (content: string, parts: Assembled['parts'] = [{ from, tokens: 10 }]): Assembled => ({ messages: [{ role: 'system', content }], parts, lore: [], silent: [], invalidKeys: [], loreBudget: 0, memory: null, memoryShape: null, dropped: 0, problems: { found: [], omitted: 0 }, unseen: 0 });
const comparison = (before: Assembled, after: Assembled): CacheComparison => ({ forecast: { parts: [part], removed: [], written: 10, tail: 0, against: { read: 0, of: 10, broken: { kind: 'changed', from, role: 'system' } }, prefix: false }, before: { prompt: before, wire: before.messages.map(({ content }, index) => ({ content, index })) }, after: { prompt: after, wire: after.messages.map(({ content }, index) => ({ content, index })) } });

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

it('names memory where it is first sent, and why a chat message left: memory took it, the budget dropped it or it was deleted', () => {
  const chat = { kind: 'block', id: 'chat', name: null, slot: 'chat' } as const;
  const memory = { ...chat, id: 'memory', slot: 'memory' } as const;
  const old = prompt('first', [{ from: chat, tokens: 10, origin: 'first' }]);
  const next = prompt('summary', [{ from: memory, tokens: 10, source: 'summary', cbs: [{ place: 'memory', text: '{{slot}}', rendered: '{{slot}}', seed: 'seed' }] }]);
  next.memory = { by: 'tool', text: 'summary', covered: 1, missing: 0, slot: true };
  const input = comparison(old, next);
  input.forecast.parts[0] = { ...part, from: memory, change: 'added', before: null };
  input.forecast.removed = [{ from: chat, role: 'system', tokens: 10, before: 0 }];
  const talked = { ...scope, messages: [{ message: 'first' }, { message: 'second' }] as ChatScope['messages'] };
  expect(cacheDiagnosis(input, talked).parts.map(({ kind, causes }) => [kind, causes])).toEqual([['removed', [{ kind: 'memory' }]], ['added', [{ kind: 'memory' }]]]);
  old.parts[0]!.origin = 'second';
  expect(cacheDiagnosis(input, talked).parts[0]!.causes).toEqual([{ kind: 'unknown' }]);
  next.dropped = 1;
  expect(cacheDiagnosis(input, talked).parts[0]!.causes).toEqual([{ kind: 'budget' }]);
  old.parts[0]!.origin = 'gone';
  expect(cacheDiagnosis(input, talked).parts[0]!.causes).toEqual([{ kind: 'deleted' }]);
});

it('names a part whose own text was edited', () => {
  const render = (text: string) => prompt(text, [{ from, tokens: 10, cbs: [{ place: 'clock', text, rendered: text, seed: 'seed' }] }]);
  expect(cacheDiagnosis(comparison(render('Old rule.'), render('New rule.')), scope).parts[0]!.causes).toEqual([{ kind: 'source' }]);
});

it('says why a block came or went: a tag emptied its text, or the text itself is new or gone', () => {
  const text = '{{#if {{getglobalvar::toggle_rule}}}}Rule.{{/if}}';
  const render = (rendered: string) => ({ place: 'clock', text, rendered, seed: 'seed' });
  const off: Assembled = { ...prompt(''), messages: [], parts: [], blank: [render('')] };
  const on = prompt('Rule.', [{ from, tokens: 10, cbs: [render('Rule.')] }]);
  const came = comparison(off, on);
  came.forecast.parts[0] = { ...part, change: 'added', before: null };
  expect(cacheDiagnosis(came, { ...scope, toggles: new Map([['rule', '1']]) }).parts[0]!.causes).toEqual([{ kind: 'tag', tag: '{{#if {{getglobalvar::toggle_rule}}}}', before: '', after: 'Rule.' }]);
  const went = comparison(on, off);
  went.forecast.parts = [];
  went.forecast.removed = [{ from, role: 'system', tokens: 10, before: 0 }];
  expect(cacheDiagnosis(went, scope).parts[0]!.causes).toEqual([{ kind: 'tag', tag: '{{#if {{getglobalvar::toggle_rule}}}}', before: 'Rule.', after: '' }]);
  delete off.blank;
  expect(cacheDiagnosis(came, scope).parts[0]!.causes).toEqual([{ kind: 'source' }]);
  expect(cacheDiagnosis(went, scope).parts[0]!.causes).toEqual([{ kind: 'source' }]);
});

it('names a part written anew for each send by what it is', () => {
  const input = comparison(prompt('hp 3'), prompt('hp 2'));
  input.forecast.parts[0] = { ...part, from: { kind: 'status' } };
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toEqual([{ kind: 'written' }]);
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

it('marks a changed tag that read a variable the bot\'s scripts write', () => {
  const trace: CbsTrace = { steps: [{ at: 5, end: 21, depth: 0, result: 'glad', variable: 'mood' }], omitted: 0 };
  expect(cacheTags('Mood sad.', 'Mood glad.', 'Mood {{getvar::mood}}.', trace, new Set(['mood']))).toEqual([{ kind: 'tag', tag: '{{getvar::mood}}', before: 'sad', after: 'glad', script: true }]);
  expect(cacheTags('Mood sad.', 'Mood glad.', 'Mood {{getvar::mood}}.', trace, new Set(['other']))).toEqual([{ kind: 'tag', tag: '{{getvar::mood}}', before: 'sad', after: 'glad' }]);
});

it('names the bot\'s scripts where they rewrote the changed message as it was sent, and nothing else explains it', () => {
  const input = comparison(prompt('Old text.'), prompt('New text.'));
  expect(cacheDiagnosis(input, scope).parts[0]!.causes).toEqual([{ kind: 'unknown' }]);
  expect(cacheDiagnosis({ ...input, after: { ...input.after, rewritten: [0] } }, scope).parts[0]!.causes).toEqual([{ kind: 'request' }]);
});
