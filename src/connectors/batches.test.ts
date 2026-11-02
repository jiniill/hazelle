import { describe, expect, it } from 'vitest';
import { bareModel } from './chat-completions';
import { batchLane, CONNECTION_TYPES, resolveConnection, type Route } from './registry';
import { prepareChat } from './preparation';
import type { Batches, Connection, Model } from './types';

const route = (type: string) => resolveConnection({ type, label: type, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] } as Connection) as Route;
const model: Model = { ...bareModel('m'), maxOutput: 1000 };
const messages = [{ role: 'user' as const, content: '안녕' }];
const lane = (type: string): Batches => batchLane(route(type), { model, messages, settings: { discount: true } })!;
const whole = (type: string) => prepareChat(route(type), { model, messages, settings: { streaming: false } }).request;

it('has no pool type with a discount lane, whose batch is asked about with the connection’s one account', () => {
  expect(CONNECTION_TYPES.filter((type) => type.pool && type.discount)).toEqual([]);
});

it('takes a batch lane only where the 설정 묶음 asks for the discount', () => {
  expect(batchLane(route('anthropic'), { model, messages, settings: {} })).toBeNull();
  expect(batchLane(route('openai'), { model, messages, settings: { discount: true } })).toBeNull();
});

describe('Anthropic’s Message Batches', () => {
  const batches = lane('anthropic');
  const { endpoint } = route('anthropic');

  it('submits the whole reply’s request as a batch of one, keyed by the call', () => {
    const sent = batches.submit(endpoint, model, whole('anthropic'), 'call-1');
    expect(sent).toMatchObject({ url: 'https://api.anthropic.com/v1/messages/batches', method: 'POST', headers: { 'anthropic-version': '2023-06-01' } });
    expect(JSON.parse(sent.body!)).toEqual({ requests: [{ custom_id: 'call-1', params: { model: 'm', max_tokens: 1000, messages } }] });
    expect(batches.submitted({ id: 'msgbatch_1', type: 'message_batch', processing_status: 'in_progress' })).toBe('msgbatch_1');
  });

  it('waits until the batch ended, then finds the call’s line among the results', () => {
    expect(batches.ended({ id: 'msgbatch_1', type: 'message_batch', processing_status: 'in_progress' })).toBe(false);
    expect(batches.ended({ id: 'msgbatch_1', type: 'message_batch', processing_status: 'ended' })).toBe(true);
    expect(batches.ended({ type: 'error' })).toBeNull();
    const message = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: '반가워요' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 3 } };
    const lines = [
      { custom_id: 'other', result: { type: 'expired' } },
      { custom_id: 'call-1', result: { type: 'succeeded', message } },
    ].map((line) => JSON.stringify(line)).join('\n');
    expect(batches.answer(lines, 'call-1')).toEqual({ kind: 'reply', payload: message });
    expect(batches.answer(JSON.stringify({ custom_id: 'call-1', result: { type: 'errored', error: { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too large' } } } }), 'call-1')).toEqual({ kind: 'failed', detail: 'max_tokens: too large' });
    expect(batches.answer(lines, 'missing')).toBeNull();
    expect(batches.cancel(endpoint, 'msgbatch_1')).toMatchObject({ url: 'https://api.anthropic.com/v1/messages/batches/msgbatch_1/cancel', method: 'POST' });
  });
});

describe('Gemini’s batch mode', () => {
  const batches = lane('google');
  const { endpoint } = route('google');

  it('submits the whole reply’s request inline, and reads its answer from the operation once done', () => {
    const sent = batches.submit(endpoint, model, whole('google'), 'call-1');
    expect(sent.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/m:batchGenerateContent');
    expect(JSON.parse(sent.body!)).toEqual({ batch: { display_name: 'call-1', input_config: { requests: { requests: [{ request: { contents: [{ role: 'user', parts: [{ text: '안녕' }] }] }, metadata: { key: 'call-1' } }] } } } });
    expect(batches.submitted({ name: 'batches/123', metadata: { state: 'BATCH_STATE_PENDING' } })).toBe('batches/123');
    expect(batches.check(endpoint, 'batches/123').url).toBe('https://generativelanguage.googleapis.com/v1beta/batches/123');
    expect(batches.ended({ name: 'batches/123', metadata: { state: 'BATCH_STATE_RUNNING' } })).toBe(false);
    const response = { candidates: [{ content: { parts: [{ text: '반가워요' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } };
    const done = { name: 'batches/123', done: true, metadata: { state: 'BATCH_STATE_SUCCEEDED' }, response: { inlinedResponses: { inlinedResponses: [{ response, metadata: { key: 'call-1' } }] } } };
    expect(batches.ended(done)).toBe(true);
    expect(batches.answer(JSON.stringify(done), 'call-1')).toEqual({ kind: 'reply', payload: response });
    expect(batches.answer(JSON.stringify({ name: 'batches/123', done: true, metadata: { state: 'JOB_STATE_CANCELLED' } }), 'call-1')).toEqual({ kind: 'canceled' });
    expect(batches.cancel(endpoint, 'batches/123')).toMatchObject({ url: 'https://generativelanguage.googleapis.com/v1beta/batches/123:cancel', method: 'POST' });
  });
});
