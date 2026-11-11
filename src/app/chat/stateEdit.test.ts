import { expect, test } from 'vitest';
import { statusAt, type StatusDefinition, type StatusField, type StatusOf } from '../../model/status';
import { draftOf, draftValue, itemDone, itemsOf } from './stateEdit';

const hp: StatusField = { id: 'hp', name: 'HP', kind: 'gauge', min: 0, max: 10 };
const gold: StatusField = { id: 'gold', name: '소지금', kind: 'number' };
const mood: StatusField = { id: 'mood', name: '기분', kind: 'stage', labels: ['들뜸', '심통'] };
const todo: StatusField = { id: 'todo', name: '할 일', kind: 'list', checked: true };

test('a draft is a value only once its field takes it: a number, a gauge inside its range, one of the labels', () => {
  expect(draftOf(hp, 7)).toBe('7');
  expect(draftOf(hp, undefined)).toBe('');
  expect(draftValue(hp, ' 7 ')).toBe(7);
  expect(draftValue(hp, '')).toBeUndefined();
  expect(draftValue(hp, '일곱')).toBeUndefined();
  expect(draftValue(hp, '11')).toBeUndefined();
  expect(draftValue(gold, '1,240')).toBe(1240);
  expect(draftValue(gold, '-3.5')).toBe(-3.5);
  expect(draftValue({ id: 'place', name: '장소', kind: 'text' }, ' 옥상 ')).toBe('옥상');
  expect(draftValue(mood, '심통')).toBe('심통');
  expect(draftValue(mood, '')).toBeUndefined();
});

test('a list keeps what was done through an edit of its items', () => {
  const items = itemDone(itemsOf(['장보기', '빨래'], []), '장보기', true);
  expect(items).toEqual([{ text: '장보기', done: true }, { text: '빨래' }]);
  expect(itemsOf(['빨래', '장보기', '숙제'], items)).toEqual([{ text: '빨래' }, { text: '장보기', done: true }, { text: '숙제' }]);
  expect(itemDone(items, '장보기', false)).toEqual([{ text: '장보기' }, { text: '빨래' }]);
  expect(draftValue(todo, draftOf(todo, items))).toEqual(items);
});

test('a place is its field among the values it stands in, and nothing once its field or record is gone', () => {
  const definition: StatusDefinition = { id: 'd', name: '기본', writer: 'after', fields: [hp], groups: [{ id: 'cast', name: '인물', fields: [mood], members: [] }], logs: [] };
  const of: StatusOf = { values: { hp: 7 }, groups: { cast: [{ id: 'seoha', name: '서하', values: { mood: '들뜸' } }] }, logs: {} };
  expect(statusAt(definition, of, { field: 'hp' })).toEqual({ field: hp, values: { hp: 7 } });
  expect(statusAt(definition, of, { field: 'mood', member: { group: 'cast', id: 'seoha' } })).toMatchObject({ field: mood, values: { mood: '들뜸' }, member: { name: '서하' } });
  expect(statusAt(definition, of, { field: 'mood' })).toBeUndefined();
  expect(statusAt(definition, of, { field: 'mood', member: { group: 'cast', id: 'gone' } })).toBeUndefined();
  expect(statusAt(definition, of, { field: 'hp', member: { group: 'none', id: 'seoha' } })).toBeUndefined();
});
