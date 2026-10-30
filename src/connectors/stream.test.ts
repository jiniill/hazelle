import { describe, expect, it } from 'vitest';
import anthropicMessage from './fixtures/anthropic-message.json';
import chatCompletion from './fixtures/chat-completion.json';
import { bareModel } from './chat-completions';
import { MAX_EVENT_CHARS } from './sse';
import { resolveConnection, type Route } from './registry';
import { decodeStream, type InlineThoughts } from './stream';
import type { Connection, Model, Phase } from './types';

const connection = (type: string, extra: Partial<Connection> = {}): Route =>
  resolveConnection({ type, label: type, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [], ...extra }) as Route;

const openRouter = connection('openrouter');
const anthropic = connection('anthropic');
const model = bareModel('m');

// Chunks are cut at awkward places on purpose: inside a line and inside a multi-byte character.
function body(text: string, cuts = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil(bytes.length / cuts);
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
      controller.close();
    },
  });
}

async function decode(resolved: Route, stream: ReadableStream<Uint8Array>, controller = new AbortController(), media = 'text/event-stream', inline?: InlineThoughts) {
  const parts: [Phase, string][] = [];
  const response = new Response(stream, { headers: { 'content-type': media } });
  const outcome = await decodeStream(resolved, model, response, controller.signal, (phase, text) => parts.push([phase, text]), inline);
  const joined = (phase: Phase) => parts.filter(([p]) => p === phase).map(([, text]) => text).join('');
  return { outcome, text: joined('text'), reasoning: joined('reasoning') };
}

const sse = (...events: unknown[]) => events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

describe('chat completions stream', () => {
  it('reports an oversized unfinished SSE event as failure and cancels the reader', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(MAX_EVENT_CHARS))); },
      cancel() { cancelled = true; },
    });
    expect((await decode(openRouter, stream)).outcome).toMatchObject({ state: 'failed', error: { kind: 'network', detail: 'SSE event is too large' } });
    expect(cancelled).toBe(true);
  });

  it('reads Copilot’s reasoning_text as reasoning', async () => {
    const stream = sse(chunk({ reasoning_text: '짧게 ' }), chunk({ reasoning_text: '답하자.' }), chunk({ content: '안녕.' }), chunk({}, 'stop'), '[DONE]');
    expect(await decode(openRouter, body(stream))).toMatchObject({ text: '안녕.', reasoning: '짧게 답하자.' });
  });

  it('moves a thinking block in the text to the reasoning, unless the reply keeps it', async () => {
    const stream = sse(chunk({ content: '<think>짧게</think>' }), chunk({ content: '\n안녕.' }), chunk({}, 'stop'), '[DONE]');
    expect(await decode(openRouter, body(stream))).toMatchObject({ text: '안녕.', reasoning: '짧게' });
    expect(await decode(openRouter, body(stream), undefined, undefined, { keep: true })).toMatchObject({ text: '<think>짧게</think>\n안녕.', reasoning: '' });
  });

  it('reads reasoning, text, usage and OpenRouter cost, and skips keep-alive comments', async () => {
    const stream =
      ': OPENROUTER PROCESSING\n\n' +
      sse(
        chunk({ role: 'assistant', reasoning: '인사를 ' }),
        chunk({ reasoning: '생각해요.' }),
        chunk({ content: '안녕하세요, ' }),
        chunk({ content: '반가워요!' }),
        chunk({}, 'stop'),
        {
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 8 }, cost: 0.00042 },
        },
        '[DONE]',
      );
    expect(await decode(openRouter, body(stream))).toEqual({
      text: '안녕하세요, 반가워요!',
      reasoning: '인사를 생각해요.',
      outcome: {
        inputComplete: true,
        state: 'done',
        cut: null,
        error: null,
        finishReason: 'stop',
        usage: { inputTokens: 12, cachedInputTokens: 0, cacheWriteInputTokens: null, outputTokens: 20, reasoningTokens: 8 },
        cost: { unit: 'usd', amount: 0.00042, source: 'reported' },
        replyId: null,
        calls: [],
      },
    });
  });

  it('leaves a cost the provider books later pending, with the id to look it up by', async () => {
    const stream = sse({ id: 'gen_01K', ...chunk({ content: '안녕' }) }, { id: 'gen_01K', ...chunk({}, 'stop') }, '[DONE]');
    const { outcome } = await decode(connection('vercel'), body(stream));
    expect(outcome).toMatchObject({ state: 'done', cost: 'pending', replyId: 'gen_01K' });
  });

  it('marks a reply that hit the token limit as cut', async () => {
    const { outcome, text } = await decode(openRouter, body(sse(chunk({ content: '길게 이어지다' }), chunk({}, 'length'), '[DONE]')));
    expect(text).toBe('길게 이어지다');
    expect(outcome).toMatchObject({ state: 'cut', cut: 'length', finishReason: 'length', usage: null, cost: null });
  });

  it('keeps the text a content filter stopped as a refused cut, and fails a filter that let nothing through', async () => {
    const kept = await decode(openRouter, body(sse(chunk({ content: '여기까지' }), chunk({}, 'content_filter'), '[DONE]')));
    expect(kept.text).toBe('여기까지');
    expect(kept.outcome).toMatchObject({ state: 'cut', cut: 'refused', finishReason: 'content_filter', error: null });
    const none = await decode(openRouter, body(sse(chunk({}, 'content_filter'), '[DONE]')));
    expect(none.outcome).toMatchObject({ state: 'failed', cut: null, error: { kind: 'provider', detail: 'content_filter' } });
  });

  it('fails a reply that finished without a word, and keeps one that only made a call', async () => {
    const none = await decode(openRouter, body(sse(chunk({ reasoning: '생각만' }, 'stop'), '[DONE]')));
    expect(none.outcome).toMatchObject({ state: 'failed', cut: null, error: null, finishReason: 'stop' });
    const call = await decode(openRouter, body(sse(chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{}' } }] }, 'tool_calls'), '[DONE]')));
    expect(call.outcome).toMatchObject({ state: 'done', calls: [{ name: 'f' }] });
  });

  it('marks a stream that ends without a finish reason or end marker as cut, and one with a finish reason as done', async () => {
    expect((await decode(openRouter, body(sse(chunk({ content: '중간에' }))))).outcome).toMatchObject({ state: 'cut', cut: 'no-terminal' });
    const endedWithoutTerminal = (await decode(openRouter, body(sse(chunk({ content: '끝' }, 'stop'))))).outcome;
    expect(endedWithoutTerminal).toMatchObject({ state: 'done' });
    expect(endedWithoutTerminal.inputComplete).toBeUndefined();
  });

  it("fails on the provider's mid-stream error and on an event that is not JSON", async () => {
    const error = { error: { code: 502, message: 'Provider returned error' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] };
    expect((await decode(openRouter, body(sse(chunk({ content: '앞부분' }), error)))).outcome).toMatchObject({
      state: 'failed',
      error: { kind: 'provider', detail: 'Provider returned error' },
    });
    expect((await decode(openRouter, body('data: {not json\n\n'))).outcome).toMatchObject({ state: 'failed', error: { kind: 'bad-event', detail: '{not json' } });
  });

  it('keeps what arrived and marks the reply as stopped when the reader is aborted', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(sse(chunk({ content: '여기까지' }))));
        controller.signal.addEventListener('abort', () => stream.error(new DOMException('aborted', 'AbortError')));
      },
    });
    const decoding = decode(openRouter, stream, controller);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await decoding).toMatchObject({ text: '여기까지', outcome: { state: 'cut', cut: 'stopped' } });
  });
});

describe('anthropic messages stream', () => {
  const start = { type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 1 } } };

  it('reads thinking and text blocks, sums cached input, and ends on message_stop', async () => {
    const stream = sse(
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '짧게 답하자.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'ping' },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '안녕하세요!' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } },
      { type: 'message_stop' },
    );
    expect(await decode(anthropic, body(stream))).toEqual({
      text: '안녕하세요!',
      reasoning: '짧게 답하자.',
      outcome: {
        inputComplete: true,
        state: 'done',
        cut: null,
        error: null,
        finishReason: 'end_turn',
        usage: { inputTokens: 125, cachedInputTokens: 100, cacheWriteInputTokens: 20, outputTokens: 15, reasoningTokens: null },
        cost: null,
        replyId: null,
        calls: [],
      },
    });
  });

  it('marks max_tokens as cut, a refusal after text as a refused cut, and an error event as failed', async () => {
    const truncated = sse(start, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 9 } }, { type: 'message_stop' });
    expect((await decode(anthropic, body(truncated))).outcome).toMatchObject({ state: 'cut', cut: 'length' });
    const refused = sse(start, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '여기까지' } }, { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 3 } }, { type: 'message_stop' });
    expect((await decode(anthropic, body(refused))).outcome).toMatchObject({ state: 'cut', cut: 'refused', finishReason: 'refusal' });
    const failed = sse(start, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    expect((await decode(anthropic, body(failed))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'Overloaded' } });
  });
});

it('uses unquoted string errors in both streams without changing their terminal rules', async () => {
  expect((await decode(openRouter, body(sse({ error: 'Overloaded' })))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'Overloaded' } });
  expect((await decode(anthropic, body(sse({ type: 'error', error: 'Overloaded' })))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'Overloaded' } });
  expect(anthropic.codec.terminal({ error: 'Not an Anthropic terminal' })).toBeNull();
  expect(openRouter.codec.terminal({ error: null })).toBeNull();
});

describe('a reply asked for whole', () => {
  const whole = (resolved: Route, payload: unknown) => decode(resolved, body(JSON.stringify(payload)), new AbortController(), 'application/json; charset=utf-8');

  it('reads a chat.completion into the same outcome as its stream', async () => {
    expect(await whole(openRouter, chatCompletion)).toEqual({
      text: '안녕하세요, 반가워요!',
      reasoning: '인사를 생각해요.',
      outcome: {
        inputComplete: true,
        state: 'done',
        cut: null,
        error: null,
        finishReason: 'stop',
        usage: { inputTokens: 12, cachedInputTokens: 0, cacheWriteInputTokens: null, outputTokens: 20, reasoningTokens: 8 },
        cost: { unit: 'usd', amount: 0.00042, source: 'reported' },
        replyId: 'gen-1759550000-AbCdEfGhIjKlMnOp',
        calls: [],
      },
    });
  });

  it('reads a Messages message into the same outcome as its stream', async () => {
    expect(await whole(anthropic, anthropicMessage)).toEqual({
      text: '안녕하세요!',
      reasoning: '짧게 답하자.',
      outcome: {
        inputComplete: true,
        state: 'done',
        cut: null,
        error: null,
        finishReason: 'end_turn',
        usage: { inputTokens: 125, cachedInputTokens: 100, cacheWriteInputTokens: 20, outputTokens: 15, reasoningTokens: null },
        cost: null,
        replyId: 'msg_01XFDUDYJgAACzvnptvVoYEL',
        calls: [],
      },
    });
  });

  it('fails on a JSON answer that is not a reply, and on an error body', async () => {
    expect((await whole(anthropic, chatCompletion)).outcome).toMatchObject({ state: 'failed', error: { kind: 'bad-event' } });
    expect((await whole(openRouter, { error: { message: 'Overloaded' } })).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'Overloaded' } });
  });
});

describe('a discount lane’s cost', () => {
  const priced: Model = { ...model, price: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: null, tiers: [] } };
  const openai = connection('openai');
  const reply = (tier: string) =>
    new Response(JSON.stringify({ object: 'response', id: 'r', status: 'completed', service_tier: tier, output: [{ type: 'message', content: [{ type: 'output_text', text: '안녕' }] }], usage: { input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 500_000 }, output_tokens: 1_000_000 } }), { headers: { 'content-type': 'application/json' } });

  it('is halved only when the reply reports the lane served it', async () => {
    const flex = await decodeStream(openai, priced, reply('flex'), new AbortController().signal, () => {});
    expect(flex).toMatchObject({ discount: 'tier', cost: { amount: (1 + 0.25 + 8) / 2, source: 'price-list' } });
    const standard = await decodeStream(openai, priced, reply('default'), new AbortController().signal, () => {});
    expect(standard.discount).toBeUndefined();
    expect(standard.cost).toMatchObject({ amount: 1 + 0.25 + 8 });
  });
});
