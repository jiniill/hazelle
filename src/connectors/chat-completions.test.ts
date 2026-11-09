import { describe, expect, it } from 'vitest';
import { bareModel } from './chat-completions';
import { resolveConnection, type Route } from './registry';
import { prepareChat } from './preparation';
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
  const joined = (of: Phase) => parts.filter(([phase]) => phase === of).map(([, chunk]) => chunk).join('');
  return { outcome, text: joined('text'), reasoning: joined('reasoning') };
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
    const body = JSON.parse(prepareChat(route, { model, messages, settings: { streaming: false }, tools }).request.body!);
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

  it('echoes OpenRouter’s reasoning details on the call, each streamed block joined until it is signed', async () => {
    const { outcome } = await decode(sse(
      delta({ reasoning: '생각', reasoning_details: [{ type: 'reasoning.text', text: '생각', format: 'anthropic-claude-v1', index: 0 }] }),
      delta({ reasoning: '했다', reasoning_details: [{ type: 'reasoning.text', text: '했다', signature: 'sig', index: 0 }] }),
      delta({ reasoning_details: [{ type: 'reasoning.encrypted', data: 'x' }, { type: 'reasoning.encrypted', data: 'y' }] }),
      delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'run_test', arguments: '{}' } }] }, 'tool_calls'),
    ));
    const details = [{ type: 'reasoning.text', text: '생각했다', format: 'anthropic-claude-v1', index: 0, signature: 'sig' }, { type: 'reasoning.encrypted', data: 'x' }, { type: 'reasoning.encrypted', data: 'y' }];
    expect(outcome.calls[0]!.echo).toEqual({ reasoning: '생각했다', reasoning_details: details });
    const body = JSON.parse(prepareChat(route, { model, messages: [{ role: 'user', content: '돌려 줘' }, { role: 'assistant', content: '', calls: outcome.calls }], settings: {}, tools }).request.body!);
    expect(body.messages[1]).toMatchObject({ reasoning: '생각했다', reasoning_details: details });
  });
});

describe('chat-completions replies', () => {
  it('reads Mistral’s content chunks, streamed and whole, with thinking as reasoning', async () => {
    const thinking = { type: 'thinking', thinking: [{ type: 'text', text: '짧게' }] };
    expect(await decode(sse(delta({ content: [thinking] }), delta({ content: [{ ...thinking, thinking: [{ type: 'text', text: ' 답하자' }] }, { type: 'text', text: '안' }] }), delta({ content: '녕' }, 'stop')))).toMatchObject({ text: '안녕', reasoning: '짧게 답하자' });
    const whole = { id: 'r1', choices: [{ index: 0, message: { role: 'assistant', content: [thinking, { type: 'text', text: '안녕' }] }, finish_reason: 'stop' }] };
    expect(await decode(JSON.stringify(whole), 'application/json')).toMatchObject({ outcome: { state: 'done' }, text: '안녕', reasoning: '짧게' });
  });

  it('fails a reply that is only a refusal with its sentence, streamed and whole', async () => {
    const failed = { state: 'failed', error: { kind: 'provider', detail: '도울 수 없어요' } };
    expect((await decode(sse(delta({ content: null, refusal: '도울 수 ' }), delta({ refusal: '없어요' }, 'stop')))).outcome).toMatchObject(failed);
    const whole = { id: 'r1', choices: [{ index: 0, message: { role: 'assistant', content: null, refusal: '도울 수 없어요' }, finish_reason: 'stop' }] };
    expect((await decode(JSON.stringify(whole), 'application/json')).outcome).toMatchObject(failed);
  });
});
