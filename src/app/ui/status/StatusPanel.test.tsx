import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ShownBlock, ShownField, StatusFrame } from './shown';
import { StatusPanel } from './StatusPanel';
import { StatusPhone } from './StatusPhone';

const hp: ShownField = { id: 'hp', name: 'HP', kind: 'gauge', look: 'bar', share: 0.7, steps: 10, value: '84', max: '120', delta: { text: '-16', down: true } };
const gold: ShownField = { id: 'gold', name: '소지금', kind: 'number', value: '1,240 G' };
const todo: ShownField = { id: 'todo', name: '할 일', kind: 'list', checked: true, items: [{ text: '장보기', done: true }, { text: '빨래' }] };
const fields = (...all: ShownField[]): ShownBlock[] => all.map((field) => ({ block: 'field', field }));
const draw = (frame: StatusFrame, blocks: ShownBlock[], onChoice?: (text: string) => void) => renderToStaticMarkup(<StatusPanel name="기본" frame={frame} mood="paper" mode="dark" blocks={blocks} onChoice={onChoice} />);

it('draws a gauge as a meter read by its share, its figure and what moved it, and an unset value as a dash', () => {
  const html = draw('card', fields(hp, gold, { id: 'place', name: '장소', kind: 'text', value: '' }));
  expect(html).toContain('data-mood="paper"');
  expect(html).toMatch(/role="meter" aria-label="HP" aria-valuemin="0" aria-valuemax="100" aria-valuenow="70" aria-valuetext="84 \/ 120"/);
  expect(html).toContain('-16');
  expect(html).toContain('1,240 G');
  expect(html).toContain('—');
  // 헤이젤 keeps the reader's mode with the colour picks set back; the reader's own colours take the page's.
  expect(renderToStaticMarkup(<StatusPanel name="기본" frame="card" mood="hazelle" mode="light" blocks={[]} />)).toContain('data-mode="light" data-bg="base"');
  expect(renderToStaticMarkup(<StatusPanel name="기본" frame="card" mood="own" mode="light" blocks={[]} />)).not.toContain('data-mode');
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

it('folds to its 대표 fields on one line under a head that keeps the note and the fold, the caller\'s buttons only while open', () => {
  const head = (open: boolean) => ({ title: '기본', note: { text: '이번 턴 갱신 안 됨', warn: true }, actions: <button type="button">다시</button>, open, onOpen: () => {}, labels: { open: '펼치기', close: '접기' }, summary: [hp] });
  const drawn = (open: boolean) => renderToStaticMarkup(<StatusPanel name="기본" frame="hud" mood="neon" mode="light" blocks={fields(gold)} head={head(open)} />);
  expect(drawn(true)).toMatch(/<h3[^>]*>기본<\/h3>.*이번 턴 갱신 안 됨.*다시.*aria-label="접기".*1,240 G/);
  expect(drawn(true)).toContain('aria-expanded="true"');
  const folded = drawn(false);
  expect(folded).toMatch(/HP<\/span>.*aria-valuenow="70".*이번 턴 갱신 안 됨.*aria-label="펼치기"/);
  expect(folded).not.toContain('1,240 G');
  expect(folded).not.toContain('다시');
  // A fixed 분위기 stands in its own mode, whatever the reader's.
  expect(folded).toContain('data-mode="dark"');
});

it('lays a press over each value that is edited by hand, a record\'s too, and none over a count or a folded line', () => {
  const edit = { label: (name: string) => `${name} 수정`, onEdit: () => {} };
  const mood: ShownField = { id: 'mood', name: '기분', kind: 'stage', value: '들뜸', labels: ['들뜸', '심통'] };
  const cast = (look: 'cards' | 'table'): ShownBlock => ({ block: 'records', id: 'cast', name: '인물', look, columns: [{ id: 'mood', name: '기분' }], members: [{ id: 'seoha', name: '서하', fields: [mood] }] });
  const blocks: ShownBlock[] = [{ block: 'head', id: 'h', items: [{ id: 'place', name: '장소', value: '옥상' }] }, ...fields(hp), cast('cards'), cast('table')];
  const presses = (html: string) => [...html.matchAll(/aria-label="([^"]+) 수정"/g)].map(([, name]) => name);
  expect(presses(renderToStaticMarkup(<StatusPanel name="기본" frame="card" mood="paper" mode="dark" blocks={blocks} edit={edit} />))).toEqual(['장소', 'HP', '기분', '기분']);
  expect(presses(renderToStaticMarkup(<StatusPanel name="기본" frame="line" mood="paper" mode="dark" blocks={blocks} edit={edit} />))).toEqual(['장소', 'HP']);
  expect(presses(draw('card', blocks))).toEqual([]);
  const folded = { title: '기본', open: false, onOpen: () => {}, labels: { open: '펼치기', close: '접기' }, summary: [hp] };
  expect(presses(renderToStaticMarkup(<StatusPanel name="기본" frame="card" mood="paper" mode="dark" blocks={blocks} edit={edit} head={folded} />))).toEqual([]);
});

it('makes a record\'s name a button only where records open a page of their own', () => {
  const cast = (look: 'cards' | 'rows' | 'table'): ShownBlock => ({ block: 'records', id: 'cast', name: '인물', look, columns: [], members: [{ id: 'seoha', name: '서하', fields: [] }] });
  const blocks = [cast('cards'), cast('rows'), cast('table')];
  const names = (html: string) => html.match(/<button type="button" class="[^"]*open[^"]*">서하<\/button>/g) ?? [];
  expect(names(renderToStaticMarkup(<StatusPanel name="기본" frame="card" mood="paper" mode="dark" blocks={blocks} onMember={() => {}} />))).toHaveLength(3);
  expect(names(draw('card', blocks))).toHaveLength(0);
});

it('draws a 기록 of messages as its conversations, each with the last thing said and how many are new, and a feed as posts', () => {
  const html = draw('card', [
    { block: 'chat', id: 'c', name: '메시지', threads: [{ id: '도윤', name: '도윤', fresh: 2, messages: [{ text: '어디야?', meta: [] }, { text: '빨리 와', meta: [] }] }] },
    { block: 'feed', id: 'f', name: 'SNS', posts: [{ lead: '하린', meta: ['방금'], body: '오늘의 약초' }] },
  ]);
  expect(html).toMatch(/<button[^>]*>.*도윤.*빨리 와.*aria-label="새 메시지 2개".*<\/button>/);
  expect(html).not.toContain('어디야?');
  expect(html).toMatch(/하린.*방금.*<p[^>]*>오늘의 약초<\/p>/);
});

it("lists a 휴대폰's apps on its home, each saying what is new, and shows an open app's screen in the home's place", () => {
  const apps = [{ id: 'm', name: '메신저', icon: 'messages' as const, fresh: 3 }, { id: 'c', name: '연락처', icon: 'contacts' as const, fresh: 0 }];
  const home = renderToStaticMarkup(<StatusPhone name="휴대폰" mode="dark" apps={apps} onOpen={() => {}} />);
  expect(home).toMatch(/aria-label="새 소식 3개".*메신저.*연락처/);
  expect(home.match(/aria-label="새 소식/g)).toHaveLength(1);
  expect(home).toMatch(/aria-label="홈" disabled=""/);
  const open = renderToStaticMarkup(
    <StatusPhone name="휴대폰" mode="dark" apps={apps} onOpen={() => {}} onHome={() => {}}>
      <StatusPanel bare name="메신저" frame="card" mood="rose" mode="dark" blocks={[]} />
    </StatusPhone>,
  );
  expect(open).not.toContain('연락처');
  expect(open).toMatch(/<section[^>]*aria-label="메신저"[^>]*data-mood="rose"/);
  expect(open).not.toMatch(/aria-label="홈" disabled/);
});
