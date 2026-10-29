import { expect, it } from 'vitest';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { bareModel } from './chat-completions';
import { contextRefusal, prepareChat } from './preparation';
import { resolveConnection, type Route } from './registry';
import type { ChatMessage, Connection, Model, Protocol } from './types';

const model: Model = { ...bareModel('opaque-id'), name: 'arbitrary name', input: ['text', 'image'], output: ['text'], contextLength: 10000, maxOutput: 100 };
const connection = (protocol: Protocol): Connection => ({ type: 'generic', label: '', baseUrl: 'https://example.test', protocol, accounts: [], turns: null, starred: [] });
const route = (protocol: Protocol) => resolveConnection(connection(protocol)) as Route;
const messages: ChatMessage[] = [{ role: 'system', content: '첫 지시' }, { role: 'system', content: '다음 지시', cache: true }, { role: 'user', content: '질문', pictures: [{ type: 'image/png', data: 'BASE64_NOT_TEXT' }] }, { role: 'user', content: '계속' }];

it('measures the exact built text segments after joining, cache splits, role remapping and same-role merging', () => {
  const anthropic = prepareChat(route('anthropic-messages'), { model, messages, settings: { cache: '5m' } });
  expect(anthropic.wire).toEqual({ segments: [{ role: 'system', text: '첫 지시\n\n다음 지시' }, { role: 'user', text: '질문' }, { role: 'user', text: '계속' }], messages: 3, pictures: 1 });
  const split = prepareChat(route('anthropic-messages'), { model, messages: messages.map((message) => ({ ...message, cache: true })), settings: { cache: '5m' } });
  expect(split.wire.segments.slice(0, 2).map(({ text }) => text)).toEqual(['첫 지시', '\n\n다음 지시']);
  const gemini = prepareChat(route('gemini'), { model, messages, settings: {} });
  expect(gemini.wire).toEqual({ ...anthropic.wire, messages: 2 });
  for (const protocol of ['chat-completions', 'responses', 'anthropic-messages', 'gemini'] as const) {
    const sent = prepareChat(route(protocol), { model, messages, settings: { systemAsUser: true } });
    expect(sent.wire.segments.map(({ role }) => role)).toEqual(['user', 'user', 'user', 'user']);
    expect(sent.wire.segments.reduce((sum, { text }) => sum + countTokens(text), 0)).toBe(messages.reduce((sum, { content }) => sum + countTokens(content), 0));
    expect(sent.wire.pictures).toBe(1);
    expect(sent.request.body).toContain('BASE64_NOT_TEXT');
    expect(sent.wire.segments.some(({ text }) => text.includes('BASE64'))).toBe(false);
  }
});

it('counts the words a PDF carries, and the PDF as a picture', () => {
  const sent = prepareChat(route('gemini'), { model: { ...model, input: ['text', 'file'] }, messages: [{ role: 'user', content: '앞' }, { role: 'user', content: '뒤' }], settings: { pdf: { keep: 'recent', recent: 50 } } });
  expect(sent.pdf).toBe(true);
  expect(sent.wire.pictures).toBe(1);
  expect(sent.wire.segments.map(({ text }) => text)).toContain('[user]\n앞');
  expect(sent.wire.segments.map(({ text }) => text)).toContain('뒤');
});

it('keys the actual route and configuration, not the prompt, display name or cache fingerprint', () => {
  const prepared = (over: Partial<Parameters<typeof prepareChat>[1]>) => prepareChat(route('responses'), { model, messages, settings: { cache: '5m' }, ...over });
  const first = prepared({});
  expect(prepared({ messages: [], model: { ...model, name: 'renamed' } }).identity).toBe(first.identity);
  expect(prepared({ settings: { systemAsUser: true } }).identity).not.toBe(first.identity);
  expect(prepared({ settings: { reasoning: { kind: 'level', level: 'high' } } }).identity).not.toBe(first.identity);
});

it('recognizes only context refusals and never mistakes a total requested count for exact input', () => {
  expect(contextRefusal('anthropic-messages', { status: 400, detail: 'prompt is too long: 210,000 tokens > 200,000 maximum' })).toEqual({ actual: 210000, maximum: 200000 });
  expect(contextRefusal('gemini', { status: 400, detail: 'The input token count (1048577) exceeds the maximum number of tokens allowed (1048576).' })).toEqual({ actual: 1048577, maximum: 1048576 });
  for (const protocol of ['responses', 'chat-completions']) expect(contextRefusal(protocol, { status: 400, code: 'context_length_exceeded', detail: 'maximum context length 1000; requested 1200 tokens including 100 completion tokens' })).toEqual({ actual: null, maximum: null });
  expect(contextRefusal('chat-completions', { status: 429, code: 'context_length_exceeded', detail: '' })).toBeNull();
  expect(contextRefusal('anthropic-messages', { status: 400, detail: 'max_tokens must be greater than thinking.budget_tokens' })).toBeNull();
});

it('counts tools, calls and results once in every format, and refuses tools where the catalog says the model takes none', () => {
  const tools = [{ name: 'run_test', description: 'Runs the file.', parameters: { type: 'object', properties: {} } }];
  const turns: ChatMessage[] = [{ role: 'user', content: 'ask' }, { role: 'assistant', content: '', calls: [{ id: 'c1', name: 'run_test', arguments: '{"moment":"reply"}' }] }, { role: 'user', content: '', results: [{ id: 'c1', name: 'run_test', text: 'passed' }] }];
  for (const protocol of ['chat-completions', 'responses', 'anthropic-messages', 'gemini'] as const) {
    const texts = prepareChat(route(protocol), { model, messages: turns, settings: {}, tools }).wire.segments.map(({ text }) => text);
    expect(texts.filter((text) => text === 'passed')).toHaveLength(1);
    expect(texts.filter((text) => text.includes('"moment":"reply"'))).toHaveLength(1);
    expect(texts).toContain(JSON.stringify(tools));
  }
  expect(() => prepareChat(route('chat-completions'), { model: { ...model, tools: false }, messages: turns, settings: {}, tools })).toThrow('tools-unsupported');
});
