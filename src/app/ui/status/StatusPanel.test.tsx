import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ShownBlock, ShownField, StatusFrame } from './shown';
import { StatusPanel } from './StatusPanel';

const hp: ShownField = { id: 'hp', name: 'HP', kind: 'gauge', look: 'bar', share: 0.7, steps: 10, value: '84', max: '120', delta: { text: '-16', down: true } };
const gold: ShownField = { id: 'gold', name: '소지금', kind: 'number', value: '1,240 G' };
const todo: ShownField = { id: 'todo', name: '할 일', kind: 'list', checked: true, items: [{ text: '장보기', done: true }, { text: '빨래' }] };
const fields = (...all: ShownField[]): ShownBlock[] => all.map((field) => ({ block: 'field', field }));
const draw = (frame: StatusFrame, blocks: ShownBlock[], onChoice?: (text: string) => void) => renderToStaticMarkup(<StatusPanel name="기본" frame={frame} mood="paper" theme="dark" blocks={blocks} onChoice={onChoice} />);

it('draws a gauge as a meter read by its share, its figure and what moved it, and an unset value as a dash', () => {
  const html = draw('card', fields(hp, gold, { id: 'place', name: '장소', kind: 'text', value: '' }));
  expect(html).toContain('data-mood="paper"');
  expect(html).toMatch(/role="meter" aria-label="HP" aria-valuemin="0" aria-valuemax="100" aria-valuenow="70" aria-valuetext="84 \/ 120"/);
  expect(html).toContain('-16');
  expect(html).toContain('1,240 G');
  expect(html).toContain('—');
  // 헤이젤 keeps the reader's theme with the colour picks set back; the reader's own colours take the page's.
  expect(renderToStaticMarkup(<StatusPanel name="기본" frame="card" mood="hazelle" theme="light" blocks={[]} />)).toContain('data-theme="light" data-bg="base"');
  expect(renderToStaticMarkup(<StatusPanel name="기본" frame="card" mood="own" theme="light" blocks={[]} />)).not.toContain('data-theme');
});

it('gives each 틀 its own drawing of the same fields', () => {
  expect(draw('hud', fields(hp, todo))).toMatch(/<div class="[^"]*half[^"]*">/);
  expect(draw('card', fields(hp))).not.toMatch(/half/);
  // A diary writes a bar as cells and a checklist as lines, the done ones said so.
  const diary = draw('diary', fields(hp, todo));
  expect(diary.match(/class="[^"]*\b_?on[^"]*"/g) ?? []).toHaveLength(7);
  expect(diary).toContain('완료');
  // A line keeps a few words of each value and leaves out what needs a box.
  const line = draw('line', [...fields(hp, todo), { block: 'records', id: 'cast', name: '인물', look: 'cards', columns: [], members: [{ id: 'a', name: '서하', fields: [] }] }, { block: 'choices', id: 'c', name: '선택지', items: ['간다'] }]);
  expect(line).toContain('2개');
  expect(line).toMatch(/인물<\/span><span[^>]*>1</);
  expect(line).not.toContain('간다');
});

it('draws records as cards, rows or a table, a 기록 as rows, and choices as buttons that stand disabled with nowhere to go', () => {
  const love: ShownField = { id: 'love', name: '호감도', kind: 'gauge', look: 'bar', share: 0.72, steps: 10, value: '72', max: '100' };
  const mood: ShownField = { id: 'mood', name: '기분', kind: 'stage', value: '들뜸', labels: ['들뜸', '심통'] };
  const records = (look: 'cards' | 'rows' | 'table'): ShownBlock => ({ block: 'records', id: 'cast', name: '인물', look, columns: [{ id: 'love', name: '호감도' }, { id: 'mood', name: '기분' }], members: [{ id: 'seoha', name: '서하', fields: [love, mood] }] });
  const cards = draw('card', [records('cards')]);
  expect(cards).toMatch(/aria-hidden="true">서<\/span>/);
  expect(cards).toContain('title="기분"');
  expect(draw('card', [records('table')])).toMatch(/<th scope="row">서하<\/th><td>72<\/td><td>들뜸<\/td>/);
  expect(draw('card', [records('rows')])).toContain('aria-valuenow="72"');
  expect(draw('card', [{ block: 'log', id: 'rolls', name: '판정', columns: [{ id: 'act', name: '행동' }, { id: 'sum', name: '합' }], rows: [['방패 막기', '17']] }])).toMatch(/방패 막기<\/span><span[^>]*title="합">17/);
  const choices: ShownBlock[] = [{ block: 'tabs', id: 't', tabs: [{ id: 'a', name: '지금', blocks: [{ block: 'choices', id: 'c', name: '선택지', items: ['간다'] }] }, { id: 'b', name: '기록', blocks: fields(gold) }] }];
  expect(draw('card', choices)).toMatch(/aria-pressed="true"[^>]*>지금<.*<button type="button"[^>]*disabled=""[^>]*>간다</);
  expect(draw('card', choices, () => {})).not.toContain('disabled');
  expect(draw('card', choices)).not.toContain('1,240 G');
});
