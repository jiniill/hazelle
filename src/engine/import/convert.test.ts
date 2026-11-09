import { expect, it } from 'vitest';
import { bookLorebook, chatLorebook, DEFAULT_ORDER, readTriggers, triggerSource } from './convert';

it('reads a null insertion order as 0, where Risu sorts it, and a missing one as a new entry’s', () => {
  expect(chatLorebook([{ key: 'a', insertorder: null }, { key: 'b' }]).lore.map(({ insertionOrder }) => insertionOrder)).toEqual([0, DEFAULT_ORDER]);
  expect(bookLorebook([{ keys: ['a'], insertion_order: null }]).lore.map(({ insertionOrder }) => insertionOrder)).toEqual([0]);
});

it('keeps a Lua trigger’s type, conditions and later effects, a later Lua among them, and writes them back as read', () => {
  const condition = { type: 'var', var: 'hp', operator: '>', value: '0' };
  const later = [{ type: 'v2SetVar', var: 'seen', operator: '=', value: '1', valueType: 'value', indent: 0 }, { type: 'triggerlua', code: 'function onOutput(id) end', indent: 0 }];
  const trigger = { comment: 'main', type: 'output', conditions: [condition], effect: [{ type: 'triggerlua', code: 'function onStart(id) end' }, ...later] };
  const [read] = readTriggers([trigger]);
  expect(read).toMatchObject({ kind: 'lua', name: 'main', on: 'output', code: 'function onStart(id) end', conditions: [{ kind: 'compare' }], effects: [{ kind: 'set' }, { kind: 'lua', code: 'function onOutput(id) end' }] });
  expect(triggerSource(read!)).toEqual(trigger);
  expect(readTriggers([{ effect: [{ type: 'triggerlua', code: ' ' }, later[0]] }])).toMatchObject([{ kind: 'lua', code: ' ', effects: [{ kind: 'set' }] }]);
});
