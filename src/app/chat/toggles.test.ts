import { describe, expect, it } from 'vitest';
import { readToggles } from '../../engine/import/toggles';
import type { ToggleLine, ToggleValues } from '../../model/prompt';
import { chatToggles, toggleValue } from '../../model/toggles';
import type { ToggleSource } from '../../runtime/chat-context';
import type { Laid } from '../common/toggleLayout';
import { currentPreset, presetValues, sectionValues, shownRows, toggleRows, type ToggleRow } from './toggles';

const PROMPT: ToggleLine[] = [
  { key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' },
  { key: 'length', label: '대사 길이', kind: 'choice', options: ['짧게', '보통', '길게'], default: '1' },
];
const set = (sources: ToggleSource[], values: ToggleValues) => {
  const declared = chatToggles(sources.flatMap(({ lines }) => lines));
  return { declared, sources, value: toggleValue(declared, values) };
};
const source = (from: ToggleSource['from'], name: string, text: string): ToggleSource => ({ from, id: name, name, lines: readToggles(text), presets: [] });
const shape = (item: Laid<ToggleRow>): unknown =>
  'row' in item ? item.row.toggle.key : 'group' in item ? [item.group.line.label, item.items.map(shape)] : `${item.note.line.kind}:${item.note.line.label}`;

describe('toggle panel rows', () => {
  it('counts the toggles off their default, and keeps the ones changed at opening first while filtering', () => {
    const rows = toggleRows(set([{ from: 'prompt', id: 'P', name: 'P', lines: PROMPT, presets: [] }, source('card', 'Ari', 'sims=겹침\nstorm=폭풍 이벤트\nweather=날씨 묘사')], { length: '2', weather: '0', storm: '1' }));
    const [prompt, card] = rows.sections;
    expect(prompt!.rows.map(({ toggle, value, changed }) => [toggle.key, value, changed])).toEqual([
      ['sims', '0', false],
      ['length', '2', true],
    ]);
    expect(card!.rows.map(({ toggle, changed }) => [toggle.key, changed])).toEqual([
      ['storm', true],
      ['weather', false],
    ]);
    expect(rows.changed).toBe(2);

    const every = new Set(card!.rows);
    expect(shownRows(card!.rows, every, false, new Set(['weather'])).map(({ toggle }) => toggle.key)).toEqual(['weather', 'storm']);
    expect(shownRows(card!.rows, every, true, new Set()).map(({ toggle }) => toggle.key)).toEqual(['storm']);
  });

  it('lays each source out apart by its own lines, a key both declare under the first, and leaves out what holds no toggle and an unread line, which ends no group', () => {
    const rows = toggleRows(
      set(
        [
          source('card', 'Ari', '=날씨=group\nstorm=폭풍 이벤트\n모드 선택\nfog=안개=text\n=끝=groupEnd\n=빈 그룹=group\n==groupEnd\n=분위기=divider\n=분위기=divider\nmood=분위기=select=밝게,어둡게'),
          source('module', 'A', '=모듈 A=divider\n=설명=caption\nstorm=모듈의 폭풍\nbell=종'),
          source('module', 'B', 'ring=Ring\n=텍스트=group\nnote=메모=textarea'),
          source('module', 'C', '=혼자=divider\nstorm=또 폭풍'),
        ],
        { note: '적어 둔 말' },
      ),
    );
    expect(rows.sections.map(({ from, name, items }) => [from, name, items.map(shape)])).toEqual([
      ['card', 'Ari', [['날씨', ['storm', 'fog']], 'divider:분위기', 'mood']],
      ['module', 'A', ['divider:모듈 A', 'caption:설명', 'bell']],
      ['module', 'B', ['ring', ['텍스트', ['note']]]],
    ]);
    expect(rows.sections[2]!.rows.map(({ toggle, value }) => [toggle.key, value])).toEqual([
      ['ring', '0'],
      ['note', '적어 둔 말'],
    ]);
    expect(rows.changed).toBe(1);
  });
});

describe('toggle presets', () => {
  it('saves every toggle of its section, sets on pick only those the section still shows, and is current only while all match', () => {
    const sources = (presets: ToggleSource['presets']) => [{ from: 'prompt' as const, id: 'P', name: 'P', lines: PROMPT, presets }];
    const [saved] = toggleRows(set(sources([]), { length: '2' })).sections;
    expect(sectionValues(saved!)).toEqual({ sims: '0', length: '2' });

    const novel = { id: 'n', name: '소설', values: { sims: '1', length: '0', gone: '1' } };
    const short = { id: 's', name: '짧게', values: { length: '0' } };
    const [section] = toggleRows(set(sources([short, novel]), { sims: '1', length: '0' })).sections;
    expect(presetValues(section!, novel)).toEqual({ sims: '1', length: '0' });
    expect(presetValues(section!, short)).toEqual({ length: '0' });
    expect(currentPreset(section!)?.id).toBe('n');
    expect(currentPreset({ ...section!, presets: [short] })).toBeNull();
  });
});
