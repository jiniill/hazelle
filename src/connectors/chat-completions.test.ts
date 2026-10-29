import { describe, expect, it } from 'vitest';
import { bareModel } from './chat-completions';
import { chatRequest, resolveConnection, type Route } from './registry';
import { decodeStream } from './stream';
import type { ChatMessage, Connection, Phase } from './types';

// Shapes follow OpenAI's chat completions reference (create, streaming events) and DeepSeek's thinking mode guide, whose
// tool loop sends reasoning_content back. None was captured from a live provider.
const on: Connection = { type: 'generic', label: '직접 연결', baseUrl: 'https://api.example.com/v1', protocol: 'chat-completions', accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] };
const route = resolveConnection(on) as Route;
const model = bareModel('deepseek-chat');
const tools = [{ name: 'run_test', description: 'Runs the file.', parameters: { type: 'object', properties: { moment: { type: 'string' } } } }];

async function decode(text: string, media = 'text/event-stream') {
  const parts: [Phase, string][] = [];
  const outcome = await decodeStream(route, model, new Response(text, { headers: { 'content-type': media } }), new AbortController().signal, (phase, chunk) => parts.push([phase, chunk]));
  return { outcome, reasoning: parts.filter(([phase]) => phase === 'reasoning').map(([, chunk]) => chunk).join('') };
}

const sse = (...events: unknown[]) => `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
const delta = (part: Record<string, unknown>, finish_reason: string | null = null) => ({ id: 'r1', choices: [{ index: 0, delta: part, finish_reason }] });

describe('chat-completions tools', () => {
  it('sends the tools, a call with its echoed reasoning, and each result ahead of the user’s text', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '돌려 봐' },
      { role: 'assistant', content: '', calls: [{ id: 'c1', name: 'run_test', arguments: '{"moment":"reply"}', echo: { reasoning_content: '돌려야지' } }] },
      { role: 'user', content: '', results: [{ id: 'c1', name: 'run_test', text: 'passed' }] },
    ];
    const body = JSON.parse(chatRequest(route, { model, messages, settings: { streaming: false }, tools }).body!);
    expect(body.tools).toEqual([{ type: 'function', function: tools[0] }]);
    expect(body.messages).toEqual([
      { role: 'user', content: '돌려 봐' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_test', arguments: '{"moment":"reply"}' } }], reasoning_content: '돌려야지' },
      { role: 'tool', tool_call_id: 'c1', content: 'passed' },
    ]);
  });

  it('assembles a streamed call from argument chunks and carries the reasoning before it as its echo', async () => {
    const { outcome, reasoning } = await decode(sse(
      delta({ reasoning_content: '돌려' }),
      delta({ reasoning_content: '야지' }),
      delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'run_test', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"moment":' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"reply"}' } }] }),
      delta({}, 'tool_calls'),
    ));
    expect(reasoning).toBe('돌려야지');
    expect(outcome).toMatchObject({ state: 'done', cut: null, finishReason: 'tool_calls', calls: [{ id: 'c1', name: 'run_test', arguments: '{"moment":"reply"}', echo: { reasoning_content: '돌려야지' } }] });
  });

  it('reads the calls of a whole reply, making up an id where it names none', async () => {
    const reply = { id: 'r1', choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'run_test', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] };
    const { outcome } = await decode(JSON.stringify(reply), 'application/json');
    expect(outcome).toMatchObject({ state: 'done', finishReason: 'tool_calls', calls: [{ id: 'call_0', name: 'run_test', arguments: '{}' }] });
    expect(outcome.calls[0]).not.toHaveProperty('echo');
  });
});
