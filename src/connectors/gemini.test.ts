import { describe, expect, it } from 'vitest';
import recorded from './fixtures/gemini.json';
import { chatRequest, detect, embedAnswer, embedRequests, parseCatalog, resolveConnection, withCredential, type Route } from './registry';
import { gemini } from './gemini';
import { decodeStream } from './stream';
import type { Phase, StreamFacts } from './types';

const embedRequest = (...args: Parameters<typeof embedRequests>) => embedRequests(...args)[0]!.request;

const google = resolveConnection({ type: 'google', label: 'Google', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] }) as Route;
const [flash, old] = parseCatalog(google, recorded.models)!;

async function decode(text: string, media = 'text/event-stream') {
  const parts: [Phase, string][] = [];
  const response = new Response(text, { headers: { 'content-type': media } });
  const outcome = await decodeStream(google, flash!, response, new AbortController().signal, (phase, chunk) => parts.push([phase, chunk]));
  const joined = (phase: Phase) => parts.filter(([p]) => p === phase).map(([, chunk]) => chunk).join('');
  return { outcome, text: joined('text'), reasoning: joined('reasoning') };
}

const sse = (...events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

describe('Gemini', () => {
  it('is found by its key and lists the models that generate content or embed', () => {
    expect(detect(`AIza${'x'.repeat(35)}`)).toMatchObject({ kind: 'key', type: { id: 'google' } });
    expect(parseCatalog(google, recorded.models)!.map(({ id, output }) => [id, output])).toEqual([['gemini-3.5-flash', null], ['gemini-2.0-flash', null], ['gemini-embedding-001', ['embedding']]]);
    expect(flash).toMatchObject({ name: 'Gemini 3.5 Flash', contextLength: 1048576, maxOutput: 65536, reasoning: true });
    expect(old!.reasoning).toBe(false);
  });

  it('sends the earlier conversation as one PDF part at low resolution, the system prompt and recent turns as text', () => {
    const body = JSON.parse(chatRequest(google, {
      model: flash!,
      messages: [{ role: 'system', content: '규칙' }, { role: 'user', content: '안녕' }, { role: 'assistant', content: '어서 와.' }, { role: 'user', content: '뭐 해?' }],
      settings: { pdf: { keep: 'recent', recent: 30 } },
    }).body!);
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: '규칙' }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: expect.any(String) }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } }, { text: expect.stringContaining('U+2029') }, { text: '뭐 해?' }] }],
      generationConfig: { thinkingConfig: { includeThoughts: true } },
    });
    expect(atob(body.contents[0].parts[0].inlineData.data).startsWith('%PDF-1.7')).toBe(true);
  });

  it('sends the leading system text apart and a later one in its place, one turn per run of a role, and thinking with its thoughts', () => {
    const request = withCredential(google, chatRequest(google, {
      model: flash!,
      messages: [
        { role: 'system', content: '규칙' },
        { role: 'assistant', content: '어서 와.' },
        { role: 'system', content: '기억' },
        { role: 'user', content: '안녕' },
        { role: 'user', content: '뭐 해?' },
      ],
      settings: { maxOutput: 1000, topK: 40, stop: ['끝'], reasoning: { kind: 'level', level: 'low' } },
    }), 'secret');
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
    expect(request.headers['x-goog-api-key']).toBe('secret');
    expect(JSON.parse(request.body!)).toEqual({
      systemInstruction: { parts: [{ text: '규칙' }] },
      contents: [
        { role: 'model', parts: [{ text: '어서 와.' }] },
        { role: 'user', parts: [{ text: 'system:기억' }, { text: '안녕' }, { text: '뭐 해?' }] },
      ],
      generationConfig: { maxOutputTokens: 1000, topK: 40, stopSequences: ['끝'], thinkingConfig: { thinkingLevel: 'low', includeThoughts: true } },
    });
    const plain = chatRequest(google, { model: old!, messages: [{ role: 'user', content: '안녕' }], settings: { streaming: false } });
    expect(plain.url).toMatch(/gemini-2\.0-flash:generateContent$/);
    expect(JSON.parse(plain.body!)).toEqual({ contents: [{ role: 'user', parts: [{ text: '안녕' }] }] });
  });

  it('sends pictures as inline data ahead of their message’s text, and no empty text after pictures alone, in the run of its role', () => {
    const messages = [{ role: 'user' as const, content: '안녕' }, { role: 'user' as const, content: '이 사람은?', pictures: [{ type: 'image/png', data: 'AAAA' }] }, { role: 'user' as const, content: '', pictures: [{ type: 'image/png', data: 'BBBB' }] }];
    expect(JSON.parse(chatRequest(google, { model: { ...flash!, input: ['text', 'image'] }, messages, settings: {} }).body!).contents).toEqual([
      { role: 'user', parts: [{ text: '안녕' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: '이 사람은?' }, { inlineData: { mimeType: 'image/png', data: 'BBBB' } }] },
    ]);
  });

  it('reads thoughts apart from the text, and usage with thoughts in the output', async () => {
    const { outcome, text, reasoning } = await decode(sse(...recorded.stream));
    expect({ text, reasoning }).toEqual({ text: '안녕하세요!', reasoning: '짧게 답하자.' });
    expect(outcome).toMatchObject({ state: 'done', replyId: 'mFLhaOirDu2qz7IPzN7DqQg' });
    expect(outcome.usage).toEqual({ inputTokens: 120, cachedInputTokens: 100, cacheWriteInputTokens: null, outputTokens: 20, reasoningTokens: 16 });
  });

  it('cuts at MAX_TOKENS, keeps the text a SAFETY stop came after as a refused cut, and fails one with none or a blocked prompt', async () => {
    expect((await decode(sse(recorded.cut))).outcome).toMatchObject({ state: 'cut', cut: 'length' });
    expect((await decode(JSON.stringify(recorded.blocked), 'application/json')).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'PROHIBITED_CONTENT' } });
    const said = { candidates: [{ content: { parts: [{ text: '여기까지는 왔다' }], role: 'model' }, finishReason: 'SAFETY' }] };
    const kept = await decode(sse(said));
    expect(kept.text).toBe('여기까지는 왔다');
    expect(kept.outcome).toMatchObject({ state: 'cut', cut: 'refused', finishReason: 'SAFETY', error: null });
    const safety = { candidates: [{ content: { parts: [], role: 'model' }, finishReason: 'SAFETY' }] };
    expect((await decode(sse(safety))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'SAFETY' } });
    expect((await decode(sse(recorded.error))).outcome).toMatchObject({ state: 'failed', error: { kind: 'provider', detail: 'Resource has been exhausted (e.g. check quota).' } });
  });

  it('reports the tier usageMetadata says served it, streamed and whole, which Google’s batch lane does not read', async () => {
    const event = { candidates: [{ content: { parts: [{ text: '안녕' }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, trafficType: 'ON_DEMAND_FLEX' } };
    const facts = (): StreamFacts => ({ rawUsage: {}, finishReason: null, id: null, tier: null, calls: [] });
    const streamed = facts();
    gemini.read(event, streamed, () => {});
    const whole = facts();
    gemini.whole(event, whole, () => {});
    expect([streamed.tier, whole.tier]).toEqual(['ON_DEMAND_FLEX', 'ON_DEMAND_FLEX']);
    expect((await decode(sse(event))).outcome.discount).toBeUndefined();
  });

  it('reads calls streamed one part an event, the first with its thought signature, and ids made from their place where none came', async () => {
    const first = { candidates: [{ content: { parts: [{ functionCall: { id: 'fc1', name: 'run_test', args: { moment: 'reply' } }, thoughtSignature: 'SIG' }], role: 'model' } }] };
    const second = { candidates: [{ content: { parts: [{ functionCall: { name: 'list_files' } }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    const { outcome } = await decode(sse(first, second));
    expect(outcome).toMatchObject({ state: 'done', finishReason: 'STOP' });
    expect(outcome.calls).toEqual([{ id: 'fc1', name: 'run_test', arguments: '{"moment":"reply"}', echo: 'SIG' }, { id: 'call_1', name: 'list_files', arguments: '{}' }]);
  });

  it('reads a call from a whole reply', async () => {
    const reply = { candidates: [{ content: { parts: [{ text: '돌려 볼게.' }, { functionCall: { name: 'run_test', args: {} }, thoughtSignature: 'SIG' }], role: 'model' }, finishReason: 'STOP' }] };
    const { outcome, text } = await decode(JSON.stringify(reply), 'application/json');
    expect({ state: outcome.state, text, calls: outcome.calls }).toEqual({ state: 'done', text: '돌려 볼게.', calls: [{ id: 'call_0', name: 'run_test', arguments: '{}', echo: 'SIG' }] });
  });

  it('sends tools as JSON Schema declarations, calls with their signature after the model’s text, and results ahead of the user’s', () => {
    const body = JSON.parse(chatRequest(google, {
      model: flash!,
      messages: [
        { role: 'user', content: '돌려 봐' },
        { role: 'assistant', content: '돌려 볼게.', calls: [{ id: 'fc1', name: 'run_test', arguments: '{"moment":"reply"}', echo: 'SIG' }, { id: 'fc2', name: 'list_files', arguments: '{"broken' }] },
        { role: 'user', content: '', results: [{ id: 'fc1', name: 'run_test', text: 'passed' }, { id: 'fc2', name: 'list_files', text: 'unreadable' }] },
      ],
      settings: {},
      tools: [{ name: 'run_test', description: 'Runs the file.', parameters: { type: 'object', properties: { moment: { type: 'string' } } } }],
    }).body!);
    expect(body.tools).toEqual([{ functionDeclarations: [{ name: 'run_test', description: 'Runs the file.', parametersJsonSchema: { type: 'object', properties: { moment: { type: 'string' } } } }] }]);
    expect(body.contents.slice(1)).toEqual([
      { role: 'model', parts: [{ text: '돌려 볼게.' }, { functionCall: { id: 'fc1', name: 'run_test', args: { moment: 'reply' } }, thoughtSignature: 'SIG' }, { functionCall: { id: 'fc2', name: 'list_files', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'fc1', name: 'run_test', response: { output: 'passed' } } }, { functionResponse: { id: 'fc2', name: 'list_files', response: { output: 'unreadable' } } }] },
    ]);
  });

  it('embeds in one batch with the purpose as its task type, or before the text for Gemini Embedding 2, and reads the vectors in order', () => {
    const embedder = parseCatalog(google, recorded.models)!.at(-1)!;
    const request = embedRequest(google, embedder, ['밤', '아침'], 'query');
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents');
    expect(JSON.parse(request.body!)).toEqual({ requests: [
      { model: 'models/gemini-embedding-001', content: { parts: [{ text: '밤' }] }, embedContentConfig: { taskType: 'RETRIEVAL_QUERY' } },
      { model: 'models/gemini-embedding-001', content: { parts: [{ text: '아침' }] }, embedContentConfig: { taskType: 'RETRIEVAL_QUERY' } },
    ] });
    expect(JSON.parse(embedRequest(google, embedder, ['밤'], null).body!).requests[0]).not.toHaveProperty('embedContentConfig');
    const second = { ...embedder, id: 'gemini-embedding-2' };
    expect(JSON.parse(embedRequest(google, second, ['밤'], 'query').body!).requests[0]).toEqual({ model: 'models/gemini-embedding-2', content: { parts: [{ text: 'task: search result | query: 밤' }] } });
    expect(JSON.parse(embedRequest(google, second, ['밤'], 'document').body!).requests[0].content.parts[0].text).toBe('title: none | text: 밤');
    expect(embedAnswer(google, embedder, { embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }], usageMetadata: { promptTokenCount: 4 } }, 2)).toEqual({
      vectors: [[0.1, 0.2], [0.3, 0.4]],
      usage: { inputTokens: 4, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 0, reasoningTokens: null },
      cost: null,
    });
    expect(embedAnswer(google, embedder, { embeddings: [{ values: [0.1] }] }, 2)).toBeNull();
  });
});
