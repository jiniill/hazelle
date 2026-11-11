import { expect, test } from 'vitest';
import type { StatusChange, StatusDefinition, StatusState } from '../model/status';
import { parseStatus, statusAsk, statusSent, statusText } from './status';

const main: StatusDefinition = {
  id: 'main',
  name: '기본',
  writer: 'with',
  fields: [
    { id: 'date', name: '날짜', kind: 'text', start: '5월 12일' },
    { id: 'hp', name: 'HP', kind: 'gauge', min: 0, max: 120, start: 84 },
    { id: 'gold', name: '소지금', kind: 'number', change: true, start: 1240 },
    { id: 'mood', name: '기분', kind: 'stage', labels: ['들뜸', '심통'], start: '들뜸' },
    { id: 'todo', name: '할 일', kind: 'list', checked: true, start: [{ text: '장보기', done: true }, { text: '빨래' }] },
    { id: 'note', name: '메모', kind: 'text' },
  ],
  groups: [
    { id: 'cast', name: '인물', open: true, members: [{ id: 'seoha', name: '서하' }], fields: [{ id: 'love', name: '호감도', kind: 'gauge', min: 0, max: 100, start: 72 }, { id: 'bag', name: '소지품', kind: 'list' }] },
    { id: 'class', name: '반', members: [{ id: 'mina', name: '미나' }], fields: [{ id: 'seat', name: '자리', kind: 'text' }] },
  ],
  logs: [
    { id: 'events', name: '사건', fields: [{ id: 'what', name: '내용', kind: 'text' }] },
    { id: 'rolls', name: '판정', fields: [{ id: 'act', name: '행동', kind: 'text' }, { id: 'sum', name: '합', kind: 'number' }] },
  ],
};
const phone: StatusDefinition = { id: 'phone', name: '휴대폰', writer: 'after', fields: [{ id: 'battery', name: '배터리', kind: 'gauge', min: 0, max: 100, start: 80 }], groups: [], logs: [] };
const definitions = [main, phone];
const state: StatusState = {
  main: {
    values: { date: '5월 12일', hp: 84, gold: 1240, mood: '들뜸', todo: [{ text: '장보기', done: true }, { text: '빨래' }] },
    groups: { cast: [{ id: 'seoha', name: '서하', values: { love: 72 } }], class: [{ id: 'mina', name: '미나', values: {} }] },
    logs: { events: [{ what: '비가 왔다' }], rolls: [] },
  },
  phone: { values: { battery: 80 }, groups: {}, logs: {} },
};
const at = { definition: 'main' };
const read = (body: string) => parseStatus(`답장이에요.\n<status>\n${body}\n</status>`, definitions, state, () => 'new');

test('the state reads back as no change', () => {
  const text = statusText(definitions, state);
  expect(text).toBe(
    ['# 기본', '날짜: 5월 12일', 'HP: 84', '소지금: 1240', '기분: 들뜸', '할 일:', '- [x] 장보기', '- [ ] 빨래', '## 인물', '### 서하', '호감도: 72', '## 반', '### 미나', '## 사건', '- 비가 왔다', '## 판정', '# 휴대폰', '배터리: 80'].join('\n'),
  );
  // 소지금 is written as its change: the value it stands at, written back, is unreadable, never a move by 1240.
  expect(read(text)).toEqual({ text: '답장이에요.', found: true, changes: [], unread: [{ ...at, field: 'gold' }] });
});

test('reads fields, lists, records, rows and a second definition', () => {
  const { changes, unread } = read(
    [
      '**날짜**: 5월 13일',
      '- HP: 60/120',
      '소지금: +200 G',
      '기분: 심통',
      '할 일:',
      '- [x] 장보기',
      '- [x] 빨래',
      '- 전화하기',
      '모르는 줄: 무시',
      '## 인물',
      '### 서하',
      '호감도: 75',
      '소지품:',
      '### 유나',
      '호감도: 40',
      '## 사건',
      '- 비가 왔다',
      '- 우산을 샀다',
      '## 판정',
      '### +',
      '행동: 방패 막기',
      '합: 17',
      '# 휴대폰',
      '배터리: 79%',
    ].join('\n'),
  );
  const yuna = { group: 'cast', id: 'new' };
  expect(unread).toEqual([]);
  expect(changes).toEqual<StatusChange[]>([
    { ...at, kind: 'set', field: 'date', value: '5월 13일' },
    { ...at, kind: 'set', field: 'hp', value: 60 },
    { ...at, kind: 'move', field: 'gold', by: 200 },
    { ...at, kind: 'set', field: 'mood', value: '심통' },
    { ...at, kind: 'set', field: 'todo', value: [{ text: '장보기', done: true }, { text: '빨래', done: true }, { text: '전화하기' }] },
    { ...at, kind: 'set', field: 'love', member: { group: 'cast', id: 'seoha' }, value: 75 },
    { ...at, kind: 'set', field: 'bag', member: { group: 'cast', id: 'seoha' }, value: [] },
    { ...at, kind: 'join', group: 'cast', member: { id: 'new', name: '유나' } },
    { ...at, kind: 'set', field: 'love', member: yuna, value: 40 },
    { ...at, kind: 'row', log: 'events', values: { what: '우산을 샀다' } },
    { ...at, kind: 'row', log: 'rolls', values: { act: '방패 막기', sum: 17 } },
    { definition: 'phone', kind: 'set', field: 'battery', value: 79 },
  ]);
});

test('a line that cannot be read marks its field and changes nothing', () => {
  const { changes, unread } = read(['HP: 130', '소지금: 0', '기분: 졸림', '할 일: 장보기, 빨래', '메모: ', '## 인물', '### 서하', '호감도: 12 또는 13'].join('\n'));
  expect(changes).toEqual([{ ...at, kind: 'set', field: 'note', value: '' }]);
  expect(unread).toEqual([
    { ...at, field: 'hp' },
    { ...at, field: 'mood' },
    { ...at, field: 'todo' },
    { ...at, field: 'love', member: { group: 'cast', id: 'seoha' } },
  ]);
});

test('a record leaves an open group only, and a closed group takes no new one', () => {
  expect(read(['## 인물', '### 서하 (remove)', '## 반', '### 미나 (remove)', '### 누구', '자리: 창가'].join('\n')).changes).toEqual([{ ...at, kind: 'leave', group: 'cast', member: 'seoha' }]);
});

test('no block, or one cut before its end, is not found, and the reply loses it either way', () => {
  expect(parseStatus('답장이에요.', definitions, state, () => 'new')).toEqual({ text: '답장이에요.', found: false, changes: [], unread: [] });
  expect(parseStatus('답장이에요.\n<status>\nHP: 6', definitions, state, () => 'new')).toEqual({ text: '답장이에요.', found: false, changes: [], unread: [] });
  expect(parseStatus('<status>\nHP: 1\n</status>\n답장이에요.\n<status>\nHP: 2\n</status>', definitions, state, () => 'new')).toMatchObject({ text: '답장이에요.', changes: [{ ...at, kind: 'set', field: 'hp', value: 2 }] });
});

test('the ask names every field with what it takes', () => {
  const ask = statusAsk([main]);
  expect(ask).toContain('- HP: a number from 0 to 120');
  expect(ask).toContain('- 소지금: the amount it moved by this turn with its sign, such as +3 or -2');
  expect(ask).toContain('- 기분: one of: 들뜸, 심통');
  expect(ask).toContain('## 인물 (a group that takes new records)');
  expect(ask).toContain('## 사건 (a log)');
});

test('a writer is sent the whole state and the ask for its own definitions only, and nothing when none is declared', () => {
  const sent = statusSent(definitions, state, [phone]);
  expect(sent.startsWith(`The status as it stands:\n${statusText(definitions, state)}\n\n`)).toBe(true);
  expect(sent.endsWith(statusAsk([phone]))).toBe(true);
  expect(statusSent([phone], state, [])).toBe(`The status as it stands:\n${statusText([phone], state)}`);
  expect(statusSent([], state, [])).toBe('');
});
