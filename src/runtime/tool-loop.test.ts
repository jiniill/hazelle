import { expect, it } from 'vitest';
import type { ChatMessage, ToolCall } from '../connectors/types';
import type { Reply } from './generate';
import { toolLoop } from './tool-loop';

const reply = (calls: ToolCall[]) => ({ state: 'done', cut: null, calls }) as unknown as Reply;
const roll = { name: 'roll', description: '', parameters: { type: 'object' } };

it('runs the calls it can read, answers the rest without running them, sends every earlier round, and ends at the cap', async () => {
  const ran: unknown[] = [];
  const sent: ChatMessage[][] = [];
  const calls = [
    [{ id: 'a', name: 'roll', arguments: '{"sides":6}' }, { id: 'b', name: 'roll', arguments: '{' }, { id: 'c', name: 'fly', arguments: '{}' }],
    [{ id: 'd', name: 'roll', arguments: '{}' }],
  ];
  const looped = await toolLoop({ tools: [{ def: roll, run: async (args, before) => (ran.push([args, before]), '4') }], rounds: 2, signal: new AbortController().signal, onText: () => {} }, async (exchange, tools, onText) => {
    sent.push(exchange);
    onText('text', `${tools!.length}개`);
    return { answer: reply(calls[sent.length - 1]!) };
  });
  expect(looped).toMatchObject({ kind: 'exhausted', rounds: [{ text: '1개', results: [{ id: 'a', text: '4' }, { id: 'b', text: expect.stringContaining('not a JSON object') }, { id: 'c', text: expect.stringContaining('no such tool') }] }, { text: '1개', results: [] }] });
  expect(ran).toEqual([[{ sides: 6 }, '1개']]);
  expect(sent[1]).toEqual([{ role: 'assistant', content: '1개', calls: calls[0] }, { role: 'user', content: '', results: expect.any(Array) }]);
});
