import { expect, test } from 'vitest';
import { statusAfter, statusCourse, type StatusChange, type StatusDefinition, type StatusView } from '../../model/status';
import { fromType, STATUS_TYPES } from '../../model/statusTypes';
import { shownApp, shownAt, shownCourse, shownView, shownWhole } from './statusView';

const definition: StatusDefinition = {
  id: 'd',
  name: '기본',
  writer: 'after',
  fields: [
    { id: 'date', name: '날짜', kind: 'text', start: '5월 12일' },
    { id: 'hp', name: 'HP', kind: 'gauge', min: 0, max: 120, start: 84, main: true, tone: 'warm' },
    { id: 'karma', name: '성향', kind: 'gauge', min: -5, max: 5, start: 2 },
    { id: 'gold', name: '소지금', kind: 'number', unit: 'G', start: 1240 },
    { id: 'mood', name: '기분', kind: 'stage', labels: ['들뜸', '심통'], start: '들뜸' },
    { id: 'todo', name: '할 일', kind: 'list', checked: true, start: [{ text: '장보기', done: true }, { text: '빨래' }] },
    { id: 'next', name: '선택지', kind: 'list' },
    { id: 'note', name: '속마음', kind: 'text' },
  ],
  groups: [{ id: 'cast', name: '인물', open: true, members: [{ id: 'seoha', name: '서하' }], fields: [{ id: 'love', name: '호감도', kind: 'gauge', min: 0, max: 100, start: 72 }] }],
  logs: [{ id: 'rolls', name: '판정', fields: [{ id: 'act', name: '행동', kind: 'text' }, { id: 'sum', name: '합', kind: 'number' }] }],
};
const at = { definition: 'd' };
const earlier: StatusChange[] = [{ ...at, kind: 'row', log: 'rolls', values: { act: '달리기', sum: 9 } }];
const latest: StatusChange[] = [
  { ...at, kind: 'set', field: 'hp', value: 60 },
  { ...at, kind: 'move', field: 'gold', by: 200 },
  { ...at, kind: 'set', field: 'love', member: { group: 'cast', id: 'seoha' }, value: 75 },
  { ...at, kind: 'row', log: 'rolls', values: { act: '방패 막기', sum: 17 } },
  { ...at, kind: 'set', field: 'next', value: [{ text: '같이 하교한다' }] },
];
const before = statusAfter([definition], earlier).d!;
const now = statusAfter([definition], [...earlier, ...latest]).d!;
const view = (blocks: StatusView['blocks'], look: Partial<StatusView> = {}): StatusView => ({ id: 'v', name: '기본', frame: 'hud', mood: 'neon', blocks, ...look });
const shown = (blocks: StatusView['blocks'], was = before) => shownView(definition, view(blocks), now, was).blocks;

test('a field is shown as its kind draws it, with what the latest reply moved it by', () => {
  expect(shown([{ kind: 'field', field: 'hp' }, { kind: 'field', field: 'karma', look: 'ring' }, { kind: 'field', field: 'gold' }, { kind: 'field', field: 'mood', look: 'scale' }, { kind: 'field', field: 'todo' }, { kind: 'field', field: 'note', look: 'thought' }])).toEqual([
    { block: 'field', field: { id: 'hp', name: 'HP', main: true, tone: 'warm', kind: 'gauge', look: 'bar', share: 0.5, steps: 10, value: '60', max: '120', delta: { text: '-24', down: true } } },
    { block: 'field', field: { id: 'karma', name: '성향', kind: 'gauge', look: 'ring', share: 0.7, zero: 0.5, steps: 10, value: '2', max: '5' } },
    { block: 'field', field: { id: 'gold', name: '소지금', kind: 'number', value: '1,440 G', delta: { text: '+200', down: false } } },
    { block: 'field', field: { id: 'mood', name: '기분', kind: 'stage', value: '들뜸', labels: ['들뜸', '심통'], scale: true } },
    { block: 'field', field: { id: 'todo', name: '할 일', kind: 'list', items: [{ text: '장보기', done: true }, { text: '빨래' }], checked: true } },
    { block: 'field', field: { id: 'note', name: '속마음', kind: 'text', value: '', thought: true } },
  ]);
  // With nothing to compare against, nothing is shown as moved.
  expect(shownView(definition, view([{ kind: 'field', field: 'gold' }]), now).blocks).toEqual([{ block: 'field', field: { id: 'gold', name: '소지금', kind: 'number', value: '1,440 G' } }]);
});

test('a head, a 묶음, a 기록, choices, a section and tabs are shown from what they name', () => {
  expect(shown([{ kind: 'head', fields: ['date', 'note', 'mood'] }, { kind: 'records', group: 'cast', look: 'rows' }, { kind: 'log', log: 'rolls' }, { kind: 'choices', field: 'next' }])).toEqual([
    { block: 'head', id: '0', items: [{ id: 'date', name: '날짜', value: '5월 12일' }, { id: 'mood', name: '기분', value: '들뜸' }] },
    {
      block: 'records',
      id: 'cast',
      name: '인물',
      look: 'rows',
      columns: [{ id: 'love', name: '호감도' }],
      members: [{ id: 'seoha', name: '서하', fields: [{ id: 'love', name: '호감도', kind: 'gauge', look: 'bar', share: 0.75, steps: 10, value: '75', max: '100', delta: { text: '+3', down: false } }] }],
    },
    // The latest reply's rows only; every row when the block asks for all.
    { block: 'log', id: 'rolls', name: '판정', columns: [{ id: 'act', name: '행동' }, { id: 'sum', name: '합' }], rows: [['방패 막기', '17']] },
    { block: 'choices', id: 'next', name: '선택지', items: ['같이 하교한다'] },
  ]);
  expect(shown([{ kind: 'log', log: 'rolls', all: true }])).toMatchObject([{ rows: [['달리기', '9'], ['방패 막기', '17']] }]);
  expect(shown([{ kind: 'section', name: '몸', blocks: [{ kind: 'field', field: 'date' }] }, { kind: 'tabs', tabs: [{ id: 'a', name: '기록', blocks: [{ kind: 'log', log: 'rolls' }] }, { id: 'b', name: '빈 탭', blocks: [] }] }])).toMatchObject([
    { block: 'section', id: '0', name: '몸', blocks: [{ block: 'field' }] },
    { block: 'tabs', id: '1', tabs: [{ id: 'a', name: '기록', blocks: [{ block: 'log' }] }] },
  ]);
});

test('a block with nothing to show is left out, and gauges too few for a shape stand as fields', () => {
  expect(shown([{ kind: 'field', field: 'gone' }, { kind: 'records', group: 'gone' }, { kind: 'choices', field: 'todo' }, { kind: 'section', name: '빈', blocks: [] }, { kind: 'log', log: 'rolls' }], now)).toEqual([{ block: 'choices', id: 'todo', name: '할 일', items: ['장보기', '빨래'] }]);
  expect(shown([{ kind: 'radar', fields: ['hp', 'karma', 'gold'] }]).map((block) => block.block)).toEqual(['field', 'field']);
  const stats = { ...definition, fields: ['근력', '민첩', '체력'].map((name, index) => ({ id: `s${index}`, name, kind: 'gauge' as const, min: 0, max: 20, start: 10 + index })) };
  expect(shownView(stats, view([{ kind: 'radar', fields: ['s0', 's1', 's2'] }]), statusAfter([stats], []).d!).blocks).toEqual([
    { block: 'radar', id: '0', axes: [{ id: 's0', name: '근력', share: 0.5, value: '10' }, { id: 's1', name: '민첩', share: 0.55, value: '11' }, { id: 's2', name: '체력', share: 0.6, value: '12' }] },
  ]);
});

test('a 틀 or a 분위기 this build does not know is drawn as a card in the app colours', () => {
  const odd = { ...view([]), frame: 'board', mood: 'ocean' } as unknown as StatusView;
  expect(shownView(definition, odd, now)).toMatchObject({ frame: 'card', mood: 'hazelle' });
  expect(shownView(definition, view([]), now)).toMatchObject({ frame: 'hud', mood: 'neon' });
});

test('the whole state is every field, each 묶음 a line a record and every row of each 기록, whatever the views show', () => {
  const whole = shownWhole(definition, now, before);
  expect(whole.map((block) => (block.block === 'field' ? block.field.id : block.block))).toEqual(['date', 'hp', 'karma', 'gold', 'mood', 'todo', 'next', 'note', 'records', 'log']);
  expect(whole.at(-2)).toMatchObject({ look: 'rows', members: [{ id: 'seoha' }] });
  expect(whole.at(-1)).toMatchObject({ rows: [['달리기', '9'], ['방패 막기', '17']] });
});

test('a page of 상세 is one record as its card or one field alone, and nothing once it is gone', () => {
  const seoha = { group: 'cast', id: 'seoha' };
  expect(shownAt(definition, now, before, { field: 'gold' })).toEqual([{ block: 'field', field: { id: 'gold', name: '소지금', main: true, kind: 'number', value: '1,440 G', delta: { text: '+200', down: false } } }]);
  expect(shownAt(definition, now, before, { member: seoha })).toMatchObject([{ block: 'records', look: 'cards', members: [{ id: 'seoha', fields: [{ id: 'love', value: '75' }] }] }]);
  expect(shownAt(definition, now, before, { member: seoha, field: 'none' })).toMatchObject([{ members: [{ id: 'seoha', fields: [] }] }]);
  expect(shownAt(definition, now, before, { member: { group: 'cast', id: 'gone' } })).toEqual([]);
  expect(shownAt(definition, now, before, { field: 'gone' })).toEqual([]);
});

test('a course is written as words, a number with what it moved by from the step before', () => {
  const steps = [{ key: 'a', changes: earlier }, { key: 'b', changes: latest }, { key: 'c', changes: [{ ...at, kind: 'move', field: 'gold', by: -40 }] as StatusChange[] }];
  const course = (place: { field: string; member?: { group: string; id: string } }) => shownCourse(definition, statusCourse([definition], steps, { ...at, ...place }), place);
  expect(course({ field: 'gold' })).toEqual([{ key: null, value: '1,240 G' }, { key: 'b', value: '1,440 G', delta: { text: '+200', down: false } }, { key: 'c', value: '1,400 G', delta: { text: '-40', down: true } }]);
  expect(course({ field: 'love', member: { group: 'cast', id: 'seoha' } })).toEqual([{ key: null, value: '72' }, { key: 'b', value: '75', delta: { text: '+3', down: false } }]);
  expect(course({ field: 'next' })).toEqual([{ key: null, value: '' }, { key: 'b', value: '같이 하교한다' }]);
  expect(course({ field: 'gone' })).toEqual([]);
});

test("a 기록 shown as chat is its conversations, the last to speak first, the reader's own told apart and what the latest reply added counted", () => {
  const phone = fromType(STATUS_TYPES.find(({ id }) => id === 'phone')!, 'p');
  const row = (log: string, values: Record<string, string>): StatusChange => ({ definition: 'p', kind: 'row', log, values });
  const old = [row('messages', { with: '도윤', way: '받음', text: '어디야?', time: '오후 3:10' }), row('messages', { with: '하린', way: '받음', text: '약초 구했어' })];
  const added = [row('messages', { with: '도윤', way: '보냄', text: '가는 중' }), row('messages', { with: '도윤', way: '받음', text: '빨리 와' }), row('posts', { who: '하린', time: '방금', text: '오늘의 약초' })];
  const was = statusAfter([phone], old).p!;
  const is = statusAfter([phone], [...old, ...added]).p!;
  const [messenger, , sns] = phone.views!;
  const app = shownApp(phone, messenger!, is, was);
  expect(app).toMatchObject({ icon: 'messages', fresh: 1 });
  expect(app.blocks).toEqual([
    {
      block: 'chat',
      id: '0',
      name: '메시지',
      threads: [
        { id: '도윤', name: '도윤', fresh: 1, reply: '도윤에게 메시지를 보낸다: ', messages: [{ text: '어디야?', meta: ['오후 3:10'] }, { text: '가는 중', meta: [], mine: true }, { text: '빨리 와', meta: [] }] },
        { id: '하린', name: '하린', fresh: 0, reply: '하린에게 메시지를 보낸다: ', messages: [{ text: '약초 구했어', meta: [] }] },
      ],
    },
  ]);
  expect(shownApp(phone, sns!, is, was)).toMatchObject({ icon: 'feed', fresh: 1, blocks: [{ block: 'feed', name: 'SNS', posts: [{ lead: '하린', meta: ['방금'], body: '오늘의 약초' }] }] });
  // With no latest reply to tell them from, nothing is new.
  expect(shownApp(phone, messenger!, is).fresh).toBe(0);
  // Who sent it stands over a message where it is not the conversation's own name, and is no part of what it says.
  const named = shownView(phone, { ...messenger!, blocks: [{ kind: 'chat', log: 'messages', by: 'with', from: 'time' }] }, is).blocks[0];
  expect(named).toMatchObject({ threads: [{ messages: [{ text: '받음', meta: ['어디야?'], from: '오후 3:10' }, {}, {}] }, {}] });
});
