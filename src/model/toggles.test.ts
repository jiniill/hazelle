import { describe, expect, it } from 'vitest';
import type { Toggle } from './prompt';
import { chatToggles, lineMoves, presetHolds, presetMisses, presetSets, toggleTree, toggleValue, valuesNow } from './toggles';

const check = (key: string, label: string): Toggle => ({ key, label, kind: 'check', default: '0' });

describe('toggles', () => {
  it("declares the prompt's toggles then the card's, one per key and none for a layout line, and reads a value over its default", () => {
    const declared = chatToggles([
      { kind: 'group', label: '모드' },
      check('sims', '시뮬레이터 모드'),
      { kind: 'groupEnd' },
      check('sims', 'Sims'),
      { kind: 'divider', label: '' },
      check('nsfw', 'NSFW'),
      { key: 'name', label: '이름', kind: 'text', default: '' },
    ]);
    expect(declared.map(({ label }) => label)).toEqual(['시뮬레이터 모드', 'NSFW', '이름']);
    const value = toggleValue(declared, { nsfw: '1', gone: '1', name: '하늘' });
    expect([value('sims'), value('nsfw'), value('name'), value('gone'), value('constructor')]).toEqual(['0', '1', '하늘', null, null]);
  });

  it('moves a line into and out of a group past its head or end, a group with all it holds, and an endless group past no lone line', () => {
    const group = (label: string) => ({ kind: 'group', label }) as const;
    const end = { kind: 'groupEnd' } as const;
    // 0 a, 1 [G1, 2 b, 3 end], 4 c, 5 [G2, 6 d], 7 [G3, 8 e]
    const nodes = toggleTree([check('a', 'A'), group('G1'), check('b', 'B'), end, check('c', 'C'), group('G2'), check('d', 'D'), group('G3'), check('e', 'E')]);
    const one = (from: number, to: number) => ({ from, count: 1, to });
    expect(lineMoves(nodes, 0)).toEqual({ up: null, down: one(0, 1) });
    expect(lineMoves(nodes, 2)).toEqual({ up: one(2, 1), down: one(2, 3) });
    expect(lineMoves(nodes, 4)).toEqual({ up: one(4, 3), down: one(4, 5) });
    expect(lineMoves(nodes, 6)).toEqual({ up: one(6, 5), down: one(6, 7) });
    expect(lineMoves(nodes, 1)).toEqual({ up: { from: 1, count: 3, to: 0 }, down: { from: 1, count: 3, to: 2 } });
    expect(lineMoves(nodes, 5)).toEqual({ up: null, down: { from: 5, count: 2, to: 7 } });
    expect(lineMoves(nodes, 7)).toEqual({ up: { from: 7, count: 2, to: 5 }, down: null });
  });

  it('saves every toggle shown as a preset, sets on a pick only those still shown, and holds only while all match', () => {
    const sims = check('sims', '시뮬레이터 모드');
    const length: Toggle = { key: 'length', label: '대사 길이', kind: 'choice', options: ['짧게', '보통', '길게'], default: '1' };
    expect(valuesNow([{ toggle: sims, value: '0' }, { toggle: length, value: '2' }])).toEqual({ sims: '0', length: '2' });

    const rows = [{ toggle: sims, value: '1' }, { toggle: length, value: '0' }];
    const novel = { sims: '1', length: '0', gone: '1' };
    const short = { length: '0' };
    expect(presetSets(rows, novel)).toEqual({ sims: '1', length: '0' });
    expect(presetSets(rows, short)).toEqual({ length: '0' });
    expect(presetHolds(rows, novel)).toBe(true);
    expect(presetHolds(rows, short)).toBe(false);
    expect(presetMisses(rows, short)).toBe(1);
  });
});
