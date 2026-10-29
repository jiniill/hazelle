import { expect, it } from 'vitest';
import type { ChatScope } from '../../engine/render';
import type { ToolManifest } from '../../tool-api/manifest';
import { SAMPLE } from '../common/code/sample';
import { testEvent, testPicks } from './studio';

const manifest: ToolManifest = { api: 1, name: 'n', author: 'a', displayName: 'N', version: '1', description: '', uses: ['memory'], page: null, menu: [], settings: [], actions: [{ id: 'redo', label: '다시' }], inputs: [{ id: 'tidy', label: '다듬기' }], composer: { label: '글' } };
const message = (id: string, role: 'user' | 'assistant') => ({ id: `${id}-v`, message: id, seed: '', role, text: id, time: null });

it('offers each declared item and runs it on the chat as it stands, none on a chat without the message it needs', () => {
  expect(testPicks(manifest).map(({ value }) => value)).toEqual(['reply', 'sending', 'prompt', 'action:redo', 'input:tidy']);
  const scope: ChatScope = { ...SAMPLE, greeting: { index: 0 }, messages: [message('greet', 'assistant'), message('said', 'user'), message('told', 'assistant'), message('again', 'user')] };
  expect(testEvent('reply', scope, '', manifest)).toEqual({ kind: 'reply', reply: { index: 1, id: 'told', version: 'told-v' } });
  expect(testEvent('action:redo', scope, '', manifest)).toEqual({ kind: 'action', item: 'redo', message: { index: 2, id: 'again', version: 'again-v' } });
  expect(testEvent('input:tidy', scope, 'hi', manifest)).toEqual({ kind: 'input', item: 'tidy', text: 'hi' });
  expect(testEvent('prompt', scope, '', manifest)).toEqual({ kind: 'prompt', turn: { memory: true } });
  expect(testEvent('reply', { ...scope, messages: scope.messages.slice(0, 2) }, '', manifest)).toBeNull();
});
