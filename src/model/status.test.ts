import { expect, test } from 'vitest';
import { stateShownWith, statusAfter, statusCourse, statusViews, type StatusChange, type StatusDefinition, type StatusView } from './status';

const definition: StatusDefinition = {
  id: 'd',
  name: '기본',
  writer: 'after',
  fields: [
    { id: 'love', name: '호감도', kind: 'gauge', min: 0, max: 100, start: 50 },
    { id: 'gold', name: '소지금', kind: 'number' },
    { id: 'mood', name: '기분', kind: 'stage', labels: ['들뜸', '심통'] },
    { id: 'bag', name: '소지품', kind: 'list' },
  ],
  groups: [
    { id: 'cast', name: '인물', open: true, members: [{ id: 'seoha', name: '서하' }], fields: [{ id: 'love', name: '호감도', kind: 'gauge', min: -500, max: 500, start: 0 }] },
    { id: 'class', name: '반', members: [{ id: 'mina', name: '미나' }], fields: [] },
  ],
  logs: [{ id: 'events', name: '사건', fields: [{ id: 'what', name: '내용', kind: 'text' }] }],
};
const at = { definition: 'd' };
const after = (...changes: StatusChange[]) => statusAfter([definition], changes).d!;

test('starts from the declared starts and members', () => {
  expect(after()).toEqual({ values: { love: 50 }, groups: { cast: [{ id: 'seoha', name: '서하', values: { love: 0 } }], class: [{ id: 'mina', name: '미나', values: {} }] }, logs: { events: [] } });
});

test('a later set wins, a move is applied inside the range and from the floor when unset', () => {
  const state = after(
    { ...at, kind: 'set', field: 'love', value: 90 },
    { ...at, kind: 'move', field: 'love', by: 30 },
    { ...at, kind: 'move', field: 'gold', by: -5 },
    { ...at, kind: 'set', field: 'bag', value: [{ text: '열쇠' }] },
  );
  expect(state.values).toEqual({ love: 100, gold: -5, bag: [{ text: '열쇠' }] });
});

test('an edit made by hand at an earlier version carries through later moves', () => {
  const later: StatusChange = { ...at, kind: 'move', field: 'love', by: 3 };
  expect(after(later).values.love).toBe(53);
  expect(after({ ...at, kind: 'set', field: 'love', value: 70 }, later).values.love).toBe(73);
});

test('members join and leave an open group only, and a record keeps its own values', () => {
  const seoha = { group: 'cast', id: 'seoha' };
  const state = after(
    { ...at, kind: 'join', group: 'cast', member: { id: 'yuna', name: '유나' } },
    { ...at, kind: 'join', group: 'cast', member: { id: 'yuna', name: '유나' } },
    { ...at, kind: 'set', field: 'love', member: seoha, value: -200 },
    { ...at, kind: 'move', field: 'love', member: { group: 'cast', id: 'yuna' }, by: 40 },
    { ...at, kind: 'leave', group: 'class', member: 'mina' },
    { ...at, kind: 'join', group: 'class', member: { id: 'x', name: '누구' } },
  );
  expect(state.groups.cast).toEqual([
    { id: 'seoha', name: '서하', values: { love: -200 } },
    { id: 'yuna', name: '유나', values: { love: 40 } },
  ]);
  expect(state.groups.class).toEqual([{ id: 'mina', name: '미나', values: {} }]);
  expect(after({ ...at, kind: 'leave', group: 'cast', member: 'seoha' }).groups.cast).toEqual([]);
});

test('rows accumulate', () => {
  const row = (what: string): StatusChange => ({ ...at, kind: 'row', log: 'events', values: { what } });
  expect(after(row('비가 왔다'), row('우산을 샀다')).logs.events).toEqual([{ what: '비가 왔다' }, { what: '우산을 샀다' }]);
});

test('a change the definition no longer takes changes nothing', () => {
  const state = after(
    { ...at, kind: 'set', field: 'gone', value: 1 },
    { ...at, kind: 'set', field: 'love', value: '많음' },
    { ...at, kind: 'set', field: 'mood', value: '졸림' },
    { ...at, kind: 'move', field: 'mood', by: 1 },
    { ...at, kind: 'set', field: 'love', member: { group: 'cast', id: 'nobody' }, value: 1 },
    { ...at, kind: 'row', log: 'gone', values: { what: 'x' } },
    { definition: 'other', kind: 'set', field: 'love', value: 1 },
    { ...at, kind: 'row', log: 'events', values: { what: 3, other: 'x' } },
  );
  expect(state).toEqual(after());
});

test('a definition with no view of its own is shown whole in one: its fields, then each 묶음 and each 기록', () => {
  expect(statusViews(definition)).toEqual<StatusView[]>([
    {
      id: 'd',
      name: '기본',
      frame: 'card',
      mood: 'hazelle',
      blocks: [
        { kind: 'field', field: 'love' },
        { kind: 'field', field: 'gold' },
        { kind: 'field', field: 'mood' },
        { kind: 'field', field: 'bag' },
        { kind: 'records', group: 'cast' },
        { kind: 'records', group: 'class' },
        { kind: 'log', log: 'events' },
      ],
    },
  ]);
  const own: StatusView = { id: 'v', name: '한 줄', frame: 'line', mood: 'paper', blocks: [{ kind: 'field', field: 'love' }] };
  expect(statusViews({ ...definition, views: [own] })).toEqual([own]);
});

test('a course is where a place started and each step after which it stood differently, a record only while it is there', () => {
  const steps = [
    { key: 'a', changes: [{ ...at, kind: 'move', field: 'love', by: 5 }] as StatusChange[] },
    { key: 'b', changes: [] },
    { key: 'c', changes: [{ ...at, kind: 'set', field: 'gold', value: 3 }] as StatusChange[] },
    { key: 'd', changes: [{ ...at, kind: 'set', field: 'love', value: 55 }, { ...at, kind: 'join', group: 'cast', member: { id: 'jun', name: '준' } }] as StatusChange[] },
    { key: 'e', changes: [{ ...at, kind: 'move', field: 'love', by: -9, member: { group: 'cast', id: 'jun' } }, { ...at, kind: 'move', field: 'love', by: -5 }] as StatusChange[] },
    { key: 'f', changes: [{ ...at, kind: 'leave', group: 'cast', member: 'jun' }] as StatusChange[] },
  ];
  expect(statusCourse([definition], steps, { ...at, field: 'love' })).toEqual([{ key: null, value: 50 }, { key: 'a', value: 55 }, { key: 'e', value: 50 }]);
  expect(statusCourse([definition], steps, { ...at, field: 'love', member: { group: 'cast', id: 'jun' } })).toEqual([{ key: null, value: undefined }, { key: 'd', value: 0 }, { key: 'e', value: -9 }, { key: 'f', value: undefined }]);
  expect(statusCourse([definition], steps, { definition: 'gone', field: 'love' })).toEqual([]);
});

test('a 상태창 folded or pinned says so, unfolded or unpinned says nothing, and a view is picked per definition', () => {
  const shown = stateShownWith(stateShownWith(stateShownWith({}, { folded: true }), { pinned: true }), { view: { definition: 'd', view: 'hud' } });
  expect(shown).toEqual({ folded: true, pinned: true, views: { d: 'hud' } });
  expect(stateShownWith(stateShownWith(shown, { folded: false }), { view: { definition: 'e', view: 'card' } })).toEqual({ pinned: true, views: { d: 'hud', e: 'card' } });
  expect(stateShownWith({ pinned: true }, { pinned: false })).toEqual({});
});
