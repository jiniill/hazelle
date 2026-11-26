import { expect, it } from 'vitest';
import type { ScriptQuestion } from '../../runtime/scripts/interactions';
import type { ToolFrames } from '../../runtime/tools/facade';
import { layered } from './ChatToolLayers';

it('lays no layer while the chat asks for a consent, whoever asks, and lays them for another question or another chat\'s consent', () => {
  const frame = { menu: [], actions: [], chat: 'here', asking: false };
  const frames: ToolFrames = new Map([['asks', frame], ['quiet', frame], ['elsewhere', { ...frame, chat: 'there' }]]);
  const asked = (id: number, chat: string, module: string, question: ScriptQuestion['question']): ScriptQuestion => ({ id, chat, from: { kind: 'module', id: module }, question });
  expect(layered(frames, [], 'here')).toEqual(['asks', 'quiet']);
  expect(layered(frames, [asked(1, 'here', 'asks', { kind: 'model' })], 'here')).toEqual([]);
  expect(layered(frames, [{ id: 1, chat: 'here', from: { kind: 'character', id: 'bot' }, question: { kind: 'card', name: 'Mira' } }], 'here')).toEqual([]);
  expect(layered(frames, [asked(1, 'here', 'asks', { kind: 'confirm', text: 'Sure?' }), asked(2, 'there', 'quiet', { kind: 'model' })], 'here')).toEqual(['asks', 'quiet']);
});
