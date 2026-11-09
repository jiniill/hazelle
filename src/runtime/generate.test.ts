import { unavailableCalibration } from '../model/token-calibration';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelSettings } from '../connectors/settings';
import { RETRIES } from '../connectors/registry';
import { bareModel } from '../connectors/chat-completions';
import type { Connection, Model, Starred } from '../connectors/types';
import { Credentials } from './credential';
import { gather, generate, resume, type GenerateInput } from './generate';
import type { ObjectStore } from './store';
import type { Stored } from '../model/kinds';
import { firstTurns } from '../model/turns';
import { stopStream, stream } from './relay';
import { LOGGED, saying, stubRelay, testConnection, testLog, testServer, upstream } from './testing';
import { streamKey } from '../vault/streams';

const model: Model = bareModel('m');
const openRouter: Connection = { ...testConnection, starred: [] };

const server = testServer();
beforeEach(() => server.account());

const answer = (status: number, body: string, headers: Record<string, string>) => stubRelay(() => new Response(body, { status, headers }));

async function run(connection = openRouter, target: Starred = model, credentials = new Credentials(), settings: ModelSettings = {}, retries = RETRIES) {
  const texts: string[] = [];
  const key = await streamKey();
  const reply = await generate({
    credentials,
    log: testLog(),
    connection,
    model: target,
    settings,
    retries,
    messages: [{ role: 'user', content: '안녕' }],
    call: { id: crypto.randomUUID(), key: key.private, public: key.public, logged: LOGGED },
    signal: new AbortController().signal,
    onText: { text: (_, text) => texts.push(text), takeBack: () => {} },
  });
  return { reply, text: texts.join('') };
}

describe('generate', () => {
  it('preserves a streamed context refusal code even when its message does not name a context window', async () => {
    answer(200, 'data: {"error":{"code":"context_length_exceeded","message":"Input too large"}}\n\n', { 'x-relay': 'upstream' });
    const { reply } = await run();
    expect(reply).toMatchObject({ state: 'failed', usage: null, contextRefusal: { actual: null, maximum: null }, calibration: { eligible: false, refusal: { actual: null, maximum: null } } });
  });

  it('sends the built request through the server’s stream and streams the reply, keeping the body as it came', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"반가워요"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const log = answer(200, body, { 'x-relay': 'upstream' });
    const { reply, text } = await run();
    expect(text).toBe('반가워요');
    expect(reply).toMatchObject({ state: 'done', error: null, finishReason: 'stop', response: body });
    expect(reply.firstTextMs).toBeGreaterThanOrEqual(0);
    expect(log[0]!.sent).toMatchObject({ url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer sk-or-x' } });
  });

  it('sends a reply the provider refused for a moment again, the same request on the same account, and counts its tries', async () => {
    const answers = [new Response('{}', { status: 429, headers: { 'x-relay': 'upstream', 'retry-after': '0' } }), saying('반가워요')];
    const log = stubRelay(() => answers.shift()!);
    const { reply, text } = await run();
    expect(text).toBe('반가워요');
    expect(reply).toMatchObject({ state: 'done', tries: 2 });
    expect(log).toHaveLength(2);
    expect(log[1]!.sent).toEqual(log[0]!.sent);

    const once = stubRelay(() => new Response('{}', { status: 429, headers: { 'x-relay': 'upstream', 'retry-after': '0' } }));
    expect((await run(openRouter, model, undefined, {}, 0)).reply).toMatchObject({ state: 'failed', tries: 1, error: { kind: 'provider', status: 429 } });
    expect(once).toHaveLength(1);
  });

  it('reads a call stopped while its try waited to be sent again as stopped, whoever reads it', async () => {
    stubRelay(() => new Response('{}', { status: 429, headers: { 'x-relay': 'upstream', 'retry-after': '30' } }));
    const key = await streamKey();
    const call: GenerateInput['call'] = { id: crypto.randomUUID(), key: key.private, public: key.public, logged: LOGGED, retrying: () => stopStream(call.id) };
    const reply = await generate({ credentials: new Credentials(), log: testLog(), connection: openRouter, model, settings: {}, retries: RETRIES, messages: [{ role: 'user', content: '안녕' }], call, signal: new AbortController().signal, onText: gather() });
    expect(reply).toMatchObject({ state: 'cut', cut: 'stopped', error: null });
    expect(await stream({ id: call.id, key: key.private }, null, new AbortController().signal)).toEqual({ kind: 'stopped' });
  });

  it('names a refusal the discount lane had no room for, apart from the account’s own rate limit', async () => {
    const openai: Connection = { ...openRouter, type: 'openai', accounts: [{ id: 'key', secret: 'sk-proj-x' }] };
    const refusing = (code: string | null) => stubRelay(() => new Response(JSON.stringify({ error: { message: 'Resource unavailable', code } }), { status: 429, headers: { 'x-relay': 'upstream' } }));
    refusing(null);
    expect((await run(openai, model, undefined, { discount: true }, 0)).reply.error).toEqual({ kind: 'refused', code: 'discount-busy' });
    refusing('rate_limit_exceeded');
    expect((await run(openai, model, undefined, { discount: true }, 0)).reply.error).toMatchObject({ kind: 'provider', status: 429 });
    refusing(null);
    expect((await run(openai, model, undefined, {}, 0)).reply.error).toMatchObject({ kind: 'provider', status: 429 });
  });

  it('reads an answer with no body as a stream that ended before its end marker', async () => {
    stubRelay(() => new Response(null, { status: 204, headers: { 'x-relay': 'upstream' } }));
    expect((await run()).reply).toMatchObject({ state: 'cut', cut: 'no-terminal', error: null });
  });

  it("tells the provider's refusal, the relay's and the app's apart", async () => {
    answer(401, '{"error":{"message":"No auth credentials found","code":401}}', { 'x-relay': 'upstream' });
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401, detail: 'No auth credentials found' } });
    stubRelay(() => null);
    expect((await run(openRouter, model, undefined, {}, 0)).reply).toMatchObject({ state: 'failed', error: { kind: 'relay', code: 'upstream-unreachable' } });
    await server.wipe();
    expect((await run()).reply).toMatchObject({ state: 'failed', error: { kind: 'app', code: 'no-session' } });
  });

  it('refuses before sending when the request cannot be built', async () => {
    const log = answer(200, '', { 'x-relay': 'upstream' });
    const anthropic: Connection = { ...openRouter, type: 'anthropic', accounts: [{ id: 'key', secret: 'sk-ant-x' }] };
    expect((await run(anthropic)).reply).toMatchObject({ state: 'failed', error: { kind: 'refused', code: 'max-tokens-unknown' } });
    expect((await run({ ...openRouter, type: 'someday' })).reply).toMatchObject({ error: { kind: 'refused', code: 'unknown-connection-type' } });
    expect(log).toEqual([]);
  });

  it('sends the 묶음’s settings, leaving out one the catalog says the model does not take', async () => {
    const log = stubRelay(() => saying('네'));
    const listed: Starred = { ...model, takes: { settings: ['temperature'], reasoning: null } };
    await run(openRouter, listed, undefined, { temperature: 0.7, topP: 0.9 });
    expect(JSON.parse(log[0]!.sent.body!)).toMatchObject({ temperature: 0.7 });
    expect(JSON.parse(log[0]!.sent.body!)).not.toHaveProperty('top_p');
  });
});

describe('a connection that trades its key for a token', () => {
  const copilot: Connection = { type: 'copilot', label: 'Copilot', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'gho_x', name: 'jin' }], turns: firstTurns('group', 'key'), starred: [] };
  const gpt: Model = { ...model, id: 'gpt-4.1' };
  const USER = 'https://api.github.com/copilot_internal/user';
  const EXCHANGE = 'https://api.github.com/copilot_internal/v2/token';
  const CHAT = 'https://api.githubcopilot.com/chat/completions';
  const unlimited = () => upstream(200, { quota_snapshots: { premium_interactions: { unlimited: true } } });

  function copilotApi(lasts: number) {
    const log = stubRelay(({ url }) =>
      url === USER
        ? unlimited()
        : url === EXCHANGE
        ? upstream(200, { token: 'tid', expires_at: Math.floor(Date.now() / 1000) + lasts })
        : saying('네'),
    );
    return () => log.map((call) => call.sent);
  }

  it('sends the traded token, and trades again only when it nears its end', async () => {
    const sent = copilotApi(1800);
    const credentials = new Credentials();
    expect((await run(copilot, gpt, credentials)).text).toBe('네');
    await run(copilot, gpt, credentials);
    expect(sent().map((call) => call.url)).toEqual([USER, EXCHANGE, CHAT, CHAT]);
    expect(sent()[1]!.headers.authorization).toBe('Bearer gho_x');
    expect(sent()[2]!.headers.authorization).toBe('Bearer tid');

    const shortLived = copilotApi(30);
    const fresh = new Credentials();
    await run(copilot, gpt, fresh);
    await run(copilot, gpt, fresh);
    expect(shortLived().map((call) => call.url)).toEqual([USER, EXCHANGE, CHAT, EXCHANGE, CHAT]);
  });

  it('stops before the chat when the trade is refused', async () => {
    const log = stubRelay(({ url }) => (url === USER ? unlimited() : upstream(401, { message: 'Bad credentials' })));
    expect((await run(copilot, gpt)).reply).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401, detail: 'Bad credentials' } });
    expect(log.map((call) => call.sent.url)).toEqual([USER, EXCHANGE]);
  });

  it('refuses a model it cannot call before trading for a token', async () => {
    const log = answer(200, '', { 'x-relay': 'upstream' });
    expect((await run(copilot, { ...gpt, protocol: 'unsupported' })).reply).toMatchObject({ error: { kind: 'refused', code: 'unsupported-protocol' } });
    expect(log).toEqual([]);
  });
});

describe('a reply through a discount lane’s batch', () => {
  const anthropic: Connection = { ...openRouter, type: 'anthropic', accounts: [{ id: 'key', secret: 'sk-ant-x' }] };
  const claude: Starred = { ...model, maxOutput: 1000, price: { input: 2, output: 10, cacheRead: null, cacheWrite: null, tiers: [] } };
  const BATCHES = 'https://api.anthropic.com/v1/messages/batches';
  const message = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: '반가워요' }], stop_reason: 'end_turn', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } };
  const batch = (status: string) => upstream(200, { id: 'b1', type: 'message_batch', processing_status: status });

  // statuses: what each check answers, in turn. refusals: what each submission answers before the one that makes the
  // batch. result: the request's result once the batch ended.
  function provider(statuses: string[], { refusals = [], result = { type: 'succeeded', message } }: { refusals?: Response[]; result?: unknown } = {}) {
    let key = '';
    return stubRelay(({ url, body }) => {
      if (url === BATCHES) {
        key = (JSON.parse(body!) as { requests: { custom_id: string }[] }).requests[0]!.custom_id;
        return refusals.shift() ?? batch('in_progress');
      }
      if (url === `${BATCHES}/b1`) return batch(statuses.shift()!);
      if (url === `${BATCHES}/b1/results`) return new Response(JSON.stringify({ custom_id: key, result }), { headers: { 'x-relay': 'upstream' } });
      if (url === `${BATCHES}/b1/cancel`) return batch('canceling');
      return saying('');
    });
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  // abort stops waiting (a closed page), cancel is 멈추기.
  async function ask(batching: boolean, abort = new AbortController(), cancel = new AbortController()) {
    const key = await streamKey();
    const marked: (string | undefined)[] = [];
    let waited = false;
    let retried = 0;
    const replying = generate({
      credentials: new Credentials(),
      log: testLog(),
      connection: anthropic,
      model: claude,
      settings: { discount: true },
      retries: RETRIES,
      messages: [{ role: 'user', content: '안녕' }],
      call: { id: crypto.randomUUID(), key: key.private, public: key.public, logged: LOGGED, started: (id) => marked.push(id), retrying: () => retried++ },
      signal: abort.signal,
      onText: gather(),
      ...(batching && { batching: { waiting: () => (waited = true), cancel: cancel.signal } }),
    });
    let reply: Awaited<typeof replying> | null = null;
    void replying.then((done) => (reply = done));
    for (let tick = 0; tick < 20 && !reply; tick++) await vi.advanceTimersByTimeAsync(5_000);
    // A call that waits on no timer can still be decoding on a slow machine once the ticks run out.
    return { reply: reply ?? (await replying), marked, waited, retried };
  }

  it('submits, waits through the relay, and prices the whole answer at the lane’s discount', async () => {
    const log = provider(['in_progress', 'ended']);
    const { reply, marked, waited } = await ask(true);
    expect(reply).toMatchObject({ state: 'done', error: null, discount: 'batch', cost: { amount: (2 + 10) / 2 }, firstTextMs: null });
    expect(marked).toEqual(['b1']);
    expect(waited).toBe(true);
    expect(log.map(({ sent }) => sent.url)).toEqual([BATCHES, `${BATCHES}/b1`, `${BATCHES}/b1`, `${BATCHES}/b1/results`]);
    expect(log[0]!.sent.headers['x-api-key']).toBe('sk-ant-x');
    expect(JSON.parse(log[0]!.sent.body!).requests[0].params).not.toHaveProperty('stream');
  });

  it('never batches a call that may not wait for one, a task’s', async () => {
    const log = provider([]);
    const { reply } = await ask(false);
    expect(reply.discount).toBeUndefined();
    expect(log.map(({ sent }) => sent.url)).toEqual(['https://api.anthropic.com/v1/messages']);
    expect(JSON.parse(log[0]!.sent.body!)).toMatchObject({ stream: true });
  });

  it('asks about a batch its marker names after a reload, with the connection’s account, and reads its answer', async () => {
    const connection = { id: 'c', kind: 'connection', parent: null, rev: 1, value: { ...anthropic, starred: [claude] } };
    const store = { get: (kind: string, id: string) => (kind === 'connection' && id === 'c' ? connection : null) } as unknown as ObjectStore;
    const marker = { id: crypto.randomUUID(), kind: 'stream', parent: 'chat', rev: 1, value: { calibration: unavailableCalibration('historical'), batch: 'b1', call: { connection: 'c', source: 'Anthropic', model: 'm', modelName: 'm' }, at: Date.now(), result: 'r', for: { kind: 'reply', message: null, replaces: null, continues: null } } } as Stored<'stream'>;
    // The results line is the marker's call's: the call's id was the batch request's key.
    const log = stubRelay(({ url }) => (url === `${BATCHES}/b1` ? batch('ended') : new Response(JSON.stringify({ custom_id: marker.id, result: { type: 'succeeded', message } }), { headers: { 'x-relay': 'upstream' } })));
    let reply: Awaited<ReturnType<typeof resume>> | null = null;
    void resume({ store, credentials: new Credentials(), log: testLog() }, marker, new AbortController().signal, gather()).then((done) => (reply = done));
    for (let tick = 0; tick < 5 && !reply; tick++) await vi.advanceTimersByTimeAsync(5_000);
    expect(reply).toMatchObject({ call: marker.id, state: 'done', discount: 'batch', firstTextMs: null, request: null });
    expect(log[0]!.sent.headers['x-api-key']).toBe('sk-ant-x');
  });

  it('cancels the batch at the provider on 멈추기 and asks until it ends, reading an answer made before the cancel landed', async () => {
    const late = provider(['in_progress', 'canceling', 'canceling', 'ended']);
    const cancel = new AbortController();
    setTimeout(() => cancel.abort(), 7_000);
    expect((await ask(true, undefined, cancel)).reply).toMatchObject({ state: 'done', error: null, discount: 'batch' });
    expect(late.map(({ sent }) => sent.url)).toEqual([BATCHES, `${BATCHES}/b1`, `${BATCHES}/b1/cancel`, `${BATCHES}/b1`, `${BATCHES}/b1`, `${BATCHES}/b1`, `${BATCHES}/b1/results`]);

    provider(['in_progress', 'canceling', 'ended'], { result: { type: 'canceled' } });
    const stopped = new AbortController();
    setTimeout(() => stopped.abort(), 7_000);
    expect((await ask(true, undefined, stopped)).reply).toMatchObject({ state: 'cut', cut: 'stopped', error: null });
  });

  it('leaves the batch to its marker when the page stops waiting, a cancel asked for meanwhile sent and checked once', async () => {
    const kept = provider(['in_progress']);
    const closing = new AbortController();
    setTimeout(() => closing.abort(), 7_000);
    expect((await ask(true, closing)).reply).toMatchObject({ state: 'cut', cut: 'stopped' });
    expect(kept.map(({ sent }) => sent.url)).toEqual([BATCHES, `${BATCHES}/b1`]);

    const canceling = provider(['in_progress', 'canceling', 'canceling']);
    const cancel = new AbortController();
    const leaving = new AbortController();
    setTimeout(() => cancel.abort(), 7_000);
    setTimeout(() => leaving.abort(), 12_000);
    expect((await ask(true, leaving, cancel)).reply).toMatchObject({ state: 'cut', cut: 'stopped' });
    expect(canceling.map(({ sent }) => sent.url)).toEqual([BATCHES, `${BATCHES}/b1`, `${BATCHES}/b1/cancel`, `${BATCHES}/b1`]);
  });

  it('submits again only a submission the provider refused for a moment, after its Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const overloaded = new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529, headers: { 'x-relay': 'upstream', 'retry-after': '3' } });
    const log = provider(['ended'], { refusals: [overloaded] });
    const { reply, marked, retried } = await ask(true);
    expect(reply).toMatchObject({ state: 'done', tries: 2 });
    expect(retried).toBe(1);
    expect(marked).toEqual(['b1']);
    expect(log.filter(({ sent }) => sent.url === BATCHES).map(({ at }) => at)).toEqual([0, 3]);

    provider([], { refusals: [upstream(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } })] });
    expect((await ask(true)).reply).toMatchObject({ state: 'failed', tries: 1, error: { kind: 'provider', status: 400 } });
  });
});
