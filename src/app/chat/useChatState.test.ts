import { expect, test } from 'vitest';
import type { Message, Receipt, StatusWrite } from '../../model/chat';
import type { StatusChange, StatusDefinition } from '../../model/status';
import type { StatusWriting } from '../../runtime/tasks/status';
import { chatStates } from './useChatState';

const definition: StatusDefinition = { id: 'd', name: '기본', writer: 'after', fields: [{ id: 'hp', name: 'HP', kind: 'gauge', min: 0, max: 10, start: 5 }], groups: [], logs: [] };
const set = (value: number): StatusChange => ({ definition: 'd', kind: 'set', field: 'hp', value });
const receipt = {} as Receipt;
const wrote = (changes: StatusChange[], missed?: true): StatusWrite => ({ of: ['d'], changes, receipt, at: 1, ...(missed && { missed }) });
const message = (id: string, role: Message['role'], made: Receipt | null, status?: StatusWrite[]): Message => ({ id, role, at: 1, selected: 0, versions: [{ id: `${id}v`, seed: id, text: '', receipt: made, edited: false, at: 1, ...(status && { status }) }] });
const hi = message('hi', 'assistant', null);
const said = message('said', 'user', null);
const none: StatusWriting = new Map();
const hp = (messages: Message[], writing = none, busy = false) => {
  const [state] = chatStates([definition], messages, writing, busy);
  return [state!.before.values.hp, state!.now.values.hp, state!.mark];
};

test('the latest reply is what moved the state; a greeting and the user message move and mark nothing', () => {
  expect(chatStates([], [hi], none, false)).toEqual([]);
  expect(hp([hi])).toEqual([5, 5, null]);
  const reply = message('r', 'assistant', receipt, [wrote([set(7)])]);
  expect(hp([hi, said, reply])).toEqual([5, 7, null]);
  expect(hp([hi, said, reply, message('next', 'user', null)])).toEqual([7, 7, null]);
});

test('a latest reply whose state was not written is marked, with why when its call failed, and not while it is being written', () => {
  const bare = message('r', 'assistant', receipt);
  expect(hp([said, bare])).toEqual([5, 5, { kind: 'missed', failure: null }]);
  expect(hp([said, message('r', 'assistant', receipt, [wrote([], true)])])).toEqual([5, 5, { kind: 'missed', failure: null }]);
  expect(hp([said, bare], new Map([['rv', { chat: 'c', message: 'r', failure: null }]]))).toEqual([5, 5, { kind: 'writing' }]);
  expect(hp([said, bare], new Map([['rv', { chat: 'c', message: 'r', failure: { kind: 'gone' } }]]))).toEqual([5, 5, { kind: 'missed', failure: { kind: 'gone' } }]);
  expect(hp([said, bare], none, true)).toEqual([5, 5, null]);
});
