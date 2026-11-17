import { expect, it } from 'vitest';
import type { ScriptQuestion } from '../../runtime/scripts/interactions';
import type { ToolFrames } from '../../runtime/tools/facade';
import { layered } from './ChatToolLayers';

it('lays no layer of a module whose consent the chat is asking for, and lays it for a question of its own or another chat\'s', () => {
  const frame = { menu: [], actions: [], chat: 'here', asking: false };
  const frames: ToolFrames = new Map([['asks', frame], ['quiet', frame], ['elsewhere', { ...frame, chat: 'there' }]]);
  const asked = (id: number, chat: string, module: string, question: ScriptQuestion['question']): ScriptQuestion => ({ id, chat, from: { kind: 'module', id: module }, question });
  expect(layered(frames, [], 'here')).toEqual(['asks', 'quiet']);
  expect(layered(frames, [asked(1, 'here', 'asks', { kind: 'model' })], 'here')).toEqual(['quiet']);
  expect(layered(frames, [asked(1, 'here', 'asks', { kind: 'plugin', grants: [], hosts: [] }), asked(2, 'here', 'quiet', { kind: 'card' })], 'here')).toEqual([]);
  expect(layered(frames, [asked(1, 'here', 'asks', { kind: 'confirm', text: 'Sure?' }), asked(2, 'there', 'quiet', { kind: 'model' })], 'here')).toEqual(['asks', 'quiet']);
});
