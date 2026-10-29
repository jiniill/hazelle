import { describe, expect, it } from 'vitest';
import { bareModel } from './chat-completions';
import { chatRequest, resolveConnection, type Route } from './registry';
import { decodeStream } from './stream';
import type { Phase } from './types';

const anthropic = resolveConnection({ type: 'anthropic', label: 'Anthropic', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] }) as Route;
const model = { ...bareModel('claude-test'), maxOutput: 1000 };

async function decode(text: string, media: string) {
  const parts: [Phase, string][] = [];
  const response = new Response(text, { headers: { 'content-type': media } });
  const outcome = await decodeStream(anthropic, model, response, new AbortController().signal, (phase, chunk) => parts.push([phase, chunk]));
  const joined = (phase: Phase) => parts.filter(([p]) => p === phase).map(([, chunk]) => chunk).join('');
  return { outcome, text: joined('text'), reasoning: joined('reasoning') };
}

const sse = (...events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

describe('Anthropic Messages tools', () => {
  it('reads a streamed call from its argument chunks, with the thinking before it signed for sending back', async () => {
    const { outcome, reasoning } = await decode(sse(
      { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '날씨를 ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '봐야 해.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'EqQB' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"location":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ' "Seoul"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 89 } },
      { type: 'message_stop' },
    ), 'text/event-stream');
    expect(reasoning).toBe('날씨를 봐야 해.');
    expect(outcome).toMatchObject({ state: 'done', cut: null, finishReason: 'tool_use' });
    expect(outcome.calls).toEqual([{ id: 'toolu_1', name: 'get_weather', arguments: '{"location": "Seoul"}', echo: [{ type: 'thinking', thinking: '날씨를 봐야 해.', signature: 'EqQB' }] }]);
  });

  it('reads a call from a whole reply, with the redacted thinking before it', async () => {
    const { outcome, text } = await decode(JSON.stringify({
      type: 'message',
      id: 'msg_2',
      content: [{ type: 'redacted_thinking', data: 'ENCRYPTED' }, { type: 'text', text: '확인해 볼게.' }, { type: 'tool_use', id: 'toolu_2', name: 'get_weather', input: { location: 'Seoul' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 },
    }), 'application/json');
    expect(text).toBe('확인해 볼게.');
    expect(outcome).toMatchObject({ state: 'done', cut: null });
    expect(outcome.calls).toEqual([{ id: 'toolu_2', name: 'get_weather', arguments: '{"location":"Seoul"}', echo: [{ type: 'redacted_thinking', data: 'ENCRYPTED' }] }]);
  });

  it('sends tools, the calls after their thinking, and the results ahead of the next turn with its cache mark', () => {
    const thought = { type: 'thinking', thinking: '날씨를 봐야 해.', signature: 'EqQB' };
    const update = { type: 'thinking', thinking: '시간도.', signature: 'Fq' };
    const body = JSON.parse(chatRequest(anthropic, {
      model,
      tools: [{ name: 'get_weather', description: 'Weather now.', parameters: { type: 'object', properties: { location: { type: 'string' } } } }],
      messages: [
        { role: 'user', content: '서울 날씨와 시간?' },
        { role: 'assistant', content: '확인해 볼게.', calls: [{ id: 'toolu_1', name: 'get_weather', arguments: '{"location":"Seoul"}', echo: [thought] }, { id: 'toolu_2', name: 'get_time', arguments: '{"city":', echo: [update] }] },
        { role: 'user', content: '', cache: true, results: [{ id: 'toolu_1', name: 'get_weather', text: '맑음' }, { id: 'toolu_2', name: 'get_time', text: 'unreadable arguments' }] },
      ],
      settings: { cache: '5m' },
    }).body!);
    expect(body.tools).toEqual([{ name: 'get_weather', description: 'Weather now.', input_schema: { type: 'object', properties: { location: { type: 'string' } } } }]);
    expect(body.messages).toEqual([
      { role: 'user', content: '서울 날씨와 시간?' },
      {
        role: 'assistant',
        content: [thought, { type: 'text', text: '확인해 볼게.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { location: 'Seoul' } }, update, { type: 'tool_use', id: 'toolu_2', name: 'get_time', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '맑음' }, { type: 'tool_result', tool_use_id: 'toolu_2', content: 'unreadable arguments', cache_control: { type: 'ephemeral' } }],
      },
    ]);
  });
});
