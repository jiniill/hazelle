import { describe, expect, it } from 'vitest';
import { bareModel } from './chat-completions';
import { chatRequest, modelSettings, resolveConnection, type Route } from './registry';
import { fit, type ModelSettings } from './settings';
import { decodeStream } from './stream';
import type { ChatMessage, Connection, Phase } from './types';

// Event and reply shapes follow OpenAI's Responses API reference (streaming events, the response object) and
// provider-hub's parser (wire/formats/openai-responses.js). None was captured from a live provider.
const on: Connection = { type: 'generic', label: '직접 연결', baseUrl: 'https://api.example.com/v1', protocol: 'responses', accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] };
const route = resolveConnection(on) as Route;
const model = bareModel('gpt-5');

async function decode(resolved: Route, text: string, media = 'text/event-stream') {
  const parts: [Phase, string][] = [];
  const outcome = await decodeStream(resolved, model, new Response(text, { headers: { 'content-type': media } }), new AbortController().signal, (phase, chunk) => parts.push([phase, chunk]));
  const joined = (phase: Phase) => parts.filter(([p]) => p === phase).map(([, chunk]) => chunk).join('');
  return { outcome, text: joined('text'), reasoning: joined('reasoning') };
}

const sse = (...events: unknown[]) => events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 1024 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 }, total_tokens: 1500 };

describe('responses request', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: '짧게 답해.', cache: true },
    { role: 'user', content: '안녕', cache: true },
  ];

  it('sends input with its roles and the format’s own fields, and leaves out what it cannot carry', () => {
    const settings: ModelSettings = { maxOutput: 4000, temperature: 0.7, stop: ['끝'], reasoning: { kind: 'level', level: 'low' }, verbosity: 'low', cache: '5m' };
    expect(fit(modelSettings(on, model)!, settings).changes).toEqual([{ setting: 'stop', change: 'left-out' }]);
    const request = chatRequest(route, { model, messages, settings });
    expect(request.url).toBe('https://api.example.com/v1/responses');
    expect(JSON.parse(request.body!)).toEqual({
      model: 'gpt-5',
      input: [
        { role: 'system', content: '짧게 답해.' },
        { role: 'user', content: '안녕' },
      ],
      max_output_tokens: 4000,
      temperature: 0.7,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      prompt_cache_key: expect.stringMatching(/^hazelle-[0-9a-f]+$/),
      store: false,
      stream: true,
    });
  });

  it('keys the cache by the prefix up to the first point, so a new turn keeps the key, and sends none without caching', () => {
    const key = (sent: ChatMessage[], cache?: '5m') => JSON.parse(chatRequest(route, { model: { ...model, input: ['text', 'image'] }, messages: sent, settings: { cache } }).body!).prompt_cache_key as unknown;
    const first = key(messages, '5m');
    expect(key([...messages, { role: 'assistant', content: '안녕!' }, { role: 'user', content: '뭐 해?', cache: true }], '5m')).toBe(first);
    expect(key([{ ...messages[0]!, content: '길게 답해.' }, messages[1]!], '5m')).not.toBe(first);
    expect(key(messages)).toBeUndefined();
    const asked: ChatMessage = { role: 'user', content: '이 사람은?', cache: true };
    expect(key([{ ...asked, pictures: [{ type: 'image/png', data: 'AAAA' }] }], '5m')).not.toBe(key([asked], '5m'));
  });

  it('sends pictures as data URL input images ahead of the input text', () => {
    const shown: ChatMessage[] = [{ role: 'user', content: '이 사람은?', pictures: [{ type: 'image/png', data: 'AAAA' }] }];
    expect(JSON.parse(chatRequest(route, { model: { ...model, input: ['text', 'image'] }, messages: shown, settings: {} }).body!).input).toEqual([
      { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }, { type: 'input_text', text: '이 사람은?' }] },
    ]);
  });

  it('sends tools, an assistant’s calls after its text and a user’s results ahead of it, leaving out empty text', () => {
    const tools = [{ name: 'run_test', description: 'Runs the file.', parameters: { type: 'object', properties: {} } }];
    const turns: ChatMessage[] = [
      { role: 'user', content: '돌려 봐' },
      { role: 'assistant', content: '', calls: [{ id: 'call_1', name: 'run_test', arguments: '{"moment":"reply"}' }] },
      { role: 'user', content: '', results: [{ id: 'call_1', name: 'run_test', text: 'passed' }] },
    ];
    const body = JSON.parse(chatRequest(route, { model, messages: turns, settings: {}, tools }).body!);
    expect(body.tools).toEqual([{ type: 'function', name: 'run_test', description: 'Runs the file.', parameters: { type: 'object', properties: {} }, strict: false }]);
    expect(body.input).toEqual([
      { role: 'user', content: '돌려 봐' },
      { type: 'function_call', call_id: 'call_1', name: 'run_test', arguments: '{"moment":"reply"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'passed' },
    ]);
  });

  it('asks for the whole reply when streaming is off', () => {
    expect(JSON.parse(chatRequest(route, { model, messages, settings: { streaming: false, reasoning: { kind: 'off' } } }).body!)).toMatchObject({ reasoning: { effort: 'none' }, stream: false });
  });
});

describe('responses stream', () => {
  it('keeps cache writes as input details without adding them to total input', async () => {
    const { outcome } = await decode(route, sse({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 1200, input_tokens_details: { cached_tokens: 800, cache_write_tokens: 300 }, output_tokens: 20 } } }));
    expect(outcome.usage).toMatchObject({ inputTokens: 1200, cachedInputTokens: 800, cacheWriteInputTokens: 300 });
  });

  const created = { type: 'response.created', response: { id: 'resp_1', object: 'response', status: 'in_progress' } };

  it('reads text, the reasoning summary a paragraph per part, and the usage of the completed reply', async () => {
    const stream = sse(
      created,
      { type: 'response.reasoning_summary_part.added', summary_index: 0, part: { type: 'summary_text', text: '' } },
      { type: 'response.reasoning_summary_text.delta', summary_index: 0, delta: '인사를 ' },
      { type: 'response.reasoning_summary_text.delta', summary_index: 0, delta: '받았다.' },
      { type: 'response.reasoning_summary_part.added', summary_index: 1, part: { type: 'summary_text', text: '' } },
      { type: 'response.reasoning_summary_text.delta', summary_index: 1, delta: '짧게 답하자.' },
      { type: 'response.output_text.delta', delta: '안녕' },
      { type: 'response.output_text.delta', delta: '하세요.' },
      { type: 'response.completed', response: { id: 'resp_1', object: 'response', status: 'completed', usage } },
    );
    const { outcome, text, reasoning } = await decode(route, stream);
    expect({ text, reasoning }).toEqual({ text: '안녕하세요.', reasoning: '인사를 받았다.\n\n짧게 답하자.' });
    expect(outcome).toMatchObject({
      state: 'done',
      replyId: 'resp_1',
      finishReason: 'completed',
      usage: { inputTokens: 1200, cachedInputTokens: 1024, cacheWriteInputTokens: null, outputTokens: 300, reasoningTokens: 200 },
    });
  });

  it('reads a reply stopped at max_output_tokens as cut, keeping a missing count null', async () => {
    const incomplete = { type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 10, output_tokens: 16 } } };
    const { outcome, text } = await decode(route, sse(created, { type: 'response.output_text.delta', delta: '안녕' }, incomplete));
    expect(text).toBe('안녕');
    expect(outcome).toMatchObject({ state: 'cut', cut: 'length', finishReason: 'max_output_tokens', usage: { inputTokens: 10, cachedInputTokens: null, reasoningTokens: null } });
    const filtered = { type: 'response.incomplete', response: { id: 'resp_2', status: 'incomplete', incomplete_details: { reason: 'content_filter' } } };
    expect((await decode(route, sse(created, { type: 'response.output_text.delta', delta: '여기까지' }, filtered))).outcome).toMatchObject({ state: 'cut', cut: 'refused', finishReason: 'content_filter' });
  });

  it('fails on a failed reply and on an error event, with the provider’s message', async () => {
    const failed = { type: 'response.failed', response: { id: 'resp_1', status: 'failed', error: { code: 'server_error', message: '잠시 후 다시 시도해 주세요.' } } };
    expect((await decode(route, sse(created, failed))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: '잠시 후 다시 시도해 주세요.' } });
    const error = { type: 'error', code: 'rate_limit_exceeded', message: '요청이 너무 많아요.', param: null };
    expect((await decode(route, sse(error))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: '요청이 너무 많아요.' } });
  });

  it('reads a tool call, its arguments assembled from their chunks, as a finished reply', async () => {
    const stream = sse(
      created,
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'run_test', arguments: '', status: 'in_progress' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"moment":' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '"reply"}' },
      { type: 'response.function_call_arguments.done', item_id: 'fc_1', output_index: 0, arguments: '{"moment":"reply"}' },
      { type: 'response.completed', response: { id: 'resp_1', object: 'response', status: 'completed', usage } },
    );
    expect((await decode(route, stream)).outcome).toMatchObject({ state: 'done', finishReason: 'completed', calls: [{ id: 'call_1', name: 'run_test', arguments: '{"moment":"reply"}' }] });
  });

  it('reads a whole reply’s tool call', async () => {
    const whole = { id: 'resp_3', object: 'response', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'run_test', arguments: '{"moment":"reply"}', status: 'completed' }], usage };
    expect((await decode(route, JSON.stringify(whole), 'application/json')).outcome).toMatchObject({ state: 'done', calls: [{ id: 'call_1', name: 'run_test', arguments: '{"moment":"reply"}' }] });
  });

  it('reads a whole reply’s output items', async () => {
    const whole = {
      id: 'resp_2',
      object: 'response',
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: '짧게 답하자.' }] },
        { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '안녕하세요.', annotations: [] }] },
      ],
      usage,
    };
    const { outcome, text, reasoning } = await decode(route, JSON.stringify(whole), 'application/json');
    expect({ text, reasoning }).toEqual({ text: '안녕하세요.', reasoning: '짧게 답하자.' });
    expect(outcome).toMatchObject({ state: 'done', replyId: 'resp_2', usage: { outputTokens: 300 } });
  });
});
