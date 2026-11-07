import { expect, it } from 'vitest';
import type { Chat, ChatSummary } from '../../model/chat';
import { family, type Member } from './lineage';

const chat = (id: string, origin?: Chat['origin'], count: number | null = 10): ChatSummary => ({ id, chat: { title: null, character: null, models: {}, ...(origin && { origin }) }, count, title: id, preview: null, at: null, order: 0 });
const shape = (member: Member): unknown => [member.kind === 'chat' ? member.chat.id : `ghost:${member.name}`, member.children.map(({ kind, at, member }) => [kind, at, shape(member)])];

it('climbs to the eldest from the open chat and hangs every descendant under its origin, branches at their split and copies from the end', () => {
  const chats = [
    chat('a'),
    chat('b', { id: 'a', name: 'a', after: 'm5', shared: 5 }),
    chat('c', { id: 'b', name: 'b', after: 'm8', shared: 8 }),
    chat('d', { id: 'a', name: 'a', after: null, shared: 10 }),
    chat('e', { id: 'a', name: 'a', after: 'm2' }),
    chat('other'),
  ];
  expect(shape(family(chats, 'c'))).toEqual(['a', [
    ['branch', 5, ['b', [['branch', 8, ['c', []]]]]],
    ['copy', null, ['d', []]],
    ['branch', null, ['e', []]],
  ]]);
});

it('stands a ghost in for an origin no longer listed, its children hung from its end', () => {
  const chats = [chat('g', { id: 'gone', name: '옛 채팅', after: 'm3', shared: 3 }), chat('h', { id: 'gone', name: '옛 채팅', after: null }), chat('i', { id: 'g', name: 'g', after: 'm1', shared: 1 })];
  expect(shape(family(chats, 'i'))).toEqual(['ghost:옛 채팅', [['branch', null, ['g', [['branch', 1, ['i', []]]]]], ['copy', null, ['h', []]]]]);
});

it('places no split on an origin whose messages are not counted', () => {
  expect(shape(family([chat('a', undefined, null), chat('b', { id: 'a', name: 'a', after: 'm5', shared: 5 })], 'a'))).toEqual(['a', [['branch', null, ['b', []]]]]);
});
