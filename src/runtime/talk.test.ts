import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { bareModel } from '../connectors/chat-completions';
import { setDefaultModel } from './assignment';
import { appendUserMessage, editMessage, selectVersion, startChat } from './chat-log';
import { RELAY_HEADER } from '../contracts/http';
import { chatPrint, forecast, prior } from './cache';
import { FIRST_PROFILE_ID } from './profiles';
import type { Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import { withTurn } from './talk';
import { takeTurn } from './turn';
import { cacheSend, wouldSend } from './turn-context';

const server = testServer();

async function chatSaid(session: Session) {
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
  return chat;
}

const replies = (session: Session, chat: string) => fold(session.store.children('entry', chat)).filter(({ role }) => role === 'assistant').map((message) => shown(message));

// A chat model on Anthropic with 할인 받기 on, whose batch the provider answers: each check with the next of checks, and
// its result once ended.
async function batching(session: Session, checks: string[], result: unknown) {
  const claude = { ...bareModel('claude'), name: 'Claude', maxOutput: 1000 };
  const connection = await session.store.create('connection', { type: 'anthropic', label: 'Anthropic', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-ant-x' }], turns: null, starred: [claude] });
  if (!connection.ok) throw new Error(connection.error);
  await setDefaultModel(session.store, 'main', { connection: connection.data.id, model: claude.id });
  await session.store.update('profile', FIRST_PROFILE_ID, (current) => ({ ...current, settings: { discount: true } }));
  const BATCHES = 'https://api.anthropic.com/v1/messages/batches';
  const batch = (status: string) => upstream(200, { id: 'b1', type: 'message_batch', processing_status: status });
  let key = '';
  return stubRelay(({ url, body }) => {
    if (url === BATCHES) {
      key = (JSON.parse(body!) as { requests: { custom_id: string }[] }).requests[0]!.custom_id;
      return batch('in_progress');
    }
    if (url === `${BATCHES}/b1`) return batch(checks.shift()!);
    if (url === `${BATCHES}/b1/cancel`) return batch('canceling');
    return new Response(JSON.stringify({ custom_id: key, result }), { headers: { [RELAY_HEADER]: 'upstream' } });
  });
}

describe('withTurn', () => {
  it('shows a message sent translated with its translation before it is saved', () => {
    const translation = { text: '안녕', receipt: null, at: 0 };
    const said = { id: 'said', text: 'Hello', translation };
    const [message] = withTurn([], { chat: 'c', said, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '', reasoning: '' }, 'c');
    expect(message!.versions[0]).toMatchObject({ text: 'Hello', translation });
  });

  it('marks the message shown before it is saved, and not the saved one', () => {
    const turn = { chat: 'c', said: { id: 'said', text: 'Hello' }, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '', reasoning: '' };
    expect(withTurn([], turn, 'c')[0]!.unstored).toBe(true);
    const stored = { id: 'said', role: 'user' as const, at: 0, versions: [{ id: 'said', seed: 'said', text: 'Hello', receipt: null, edited: false, at: 0 }], selected: 0 };
    expect(withTurn([stored], turn, 'c')[0]!.unstored).toBeUndefined();
  });

  it('shows a new version of an earlier reply without what continues the others, and one in its place with it', () => {
    const message = (id: string, role: 'user' | 'assistant') => ({ id, role, at: 0, versions: [{ id, seed: id, text: id, receipt: null, edited: false, at: 0 }], selected: 0 });
    const story = [message('u1', 'user'), message('b1', 'assistant'), message('u2', 'user')];
    const turn = { chat: 'c', said: null, reply: { id: 'r', message: 'b1', replaces: null, continues: null }, text: '', reasoning: '' };
    expect(withTurn(story, turn, 'c').map(({ id }) => id)).toEqual(['u1', 'b1']);
    expect(withTurn(story, { ...turn, reply: { ...turn.reply, replaces: 'b1' } }, 'c').map(({ id }) => id)).toEqual(['u1', 'b1', 'u2']);
  });

  it('keeps a reply live once it is saved, until its turn ends', () => {
    const saved = { id: 'r', role: 'assistant' as const, at: 0, versions: [{ id: 'r', seed: 'r', text: 'Hi', receipt: null, edited: false, at: 0 }], selected: 0 };
    const turn = { chat: 'c', said: null, reply: { id: 'r', message: null, replaces: null, continues: null }, text: 'Hi', reasoning: '' };
    expect(withTurn([saved], turn, 'c')).toMatchObject([{ id: 'r', live: 'r', versions: saved.versions }]);
    expect(withTurn([saved], null, 'c')[0]!.live).toBeNull();
  });

  it('marks a reply asked for whole, or waiting on a batch, so the chat shows it when it lands', () => {
    const turn = { chat: 'c', said: null, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '', reasoning: '' };
    expect(withTurn([], { ...turn, whole: true }, 'c')[0]).toMatchObject({ live: 'r', whole: true });
    expect(withTurn([], turn, 'c')[0]!.whole).toBeUndefined();
    expect(withTurn([], { ...turn, whole: true, batch: true }, 'c')[0]).toMatchObject({ live: 'r', whole: true, batch: true });
  });
});

describe('Talk', () => {
  it('makes an earlier reply again with nothing after it, and sends after the version shown', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      stubRelay(inTurn([saying('B1'), saying('B2'), saying('B1 다시'), saying('B3')]));
      const story = () => fold(session.store.children('entry', chat)).map((message) => shown(message).text);
      expect(await takeTurn(session, chat, { kind: 'send', text: 'A1' })).toBeNull();
      expect(await takeTurn(session, chat, { kind: 'send', text: 'A2' })).toBeNull();
      const reply = fold(session.store.children('entry', chat))[1]!;
      expect(await takeTurn(session, chat, { kind: 'regenerate', message: reply.id })).toBeNull();
      expect(story()).toEqual(['A1', 'B1 다시']);
      expect(await takeTurn(session, chat, { kind: 'send', text: 'A3' })).toBeNull();
      expect(story()).toEqual(['A1', 'B1 다시', 'A3', 'B3']);
      await selectVersion(session.store, chat, reply.id, reply.id);
      expect(story()).toEqual(['A1', 'B1', 'A2', 'B2']);
    }));

  it('keeps two replies whose saves failed and retries the reply each failure names', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chats = [crypto.randomUUID(), crypto.randomUUID()];
      await server.hold(session.store, ...chats);
      for (const chat of chats) {
        await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
        await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      }

      let failing = false;
      const answers = inTurn([saying('첫 답장'), saying('다음 답장')]);
      stubRelay((sent) => {
        failing = true;
        return answers(sent);
      });
      const through = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (failing && url.startsWith('/api/objects/') ? Promise.resolve(Response.json({ error: 'server-error' }, { status: 500 })) : through(url, init)));

      const first = await takeTurn(session, chats[0]!, { kind: 'answer' });
      const second = await takeTurn(session, chats[1]!, { kind: 'answer' });
      expect(first).toEqual({ kind: 'unsaved', reply: expect.any(String), failure: { ok: false, error: 'server-error' } });
      expect(second).toEqual({ kind: 'unsaved', reply: expect.any(String), failure: { ok: false, error: 'server-error' } });
      if (first?.kind !== 'unsaved' || second?.kind !== 'unsaved' || !first.reply || !second.reply) throw new Error('Expected kept replies');
      expect(first.reply).not.toBe(second.reply);
      expect(await session.talk.saveAgain(first.reply)).toEqual(first);
      for (const chat of chats) expect(fold(session.store.children('entry', chat))).toHaveLength(1);

      failing = false;
      expect(await session.talk.saveAgain(second.reply)).toBeNull();
      expect(fold(session.store.children('entry', chats[0]!))).toHaveLength(1);
      expect(await session.talk.saveAgain(first.reply)).toBeNull();
      expect(await session.talk.saveAgain(first.reply)).toBeNull();
      for (const [index, chat] of chats.entries()) {
        const messages = fold(session.store.children('entry', chat));
        expect(messages.map((message) => shown(message).text)).toEqual(['안녕', index === 0 ? '첫 답장' : '다음 답장']);
        expect(shown(messages[1]!).id).toBe(index === 0 ? first.reply : second.reply);
      }
    }));

  it('does not keep a reply whose turn a restore ended, nor write it onto the restored chat', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });

      let restored = false;
      stubRelay(() => {
        restored = true;
        return saying('답장');
      });
      const through = globalThis.fetch;
      const refused = vi.fn();
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        if (!restored || url !== '/api/objects/batch') return through(url, init);
        refused();
        restored = false;
        return Promise.resolve(Response.json({ error: 'cache-reset' }, { status: 409 }));
      });

      expect(await takeTurn(session, chat, { kind: 'answer' })).toEqual({ kind: 'unsaved', reply: null, failure: { ok: false, error: 'timeline-changed' } });
      expect(refused).toHaveBeenCalledOnce();
      // The store ended with the restore, so nothing of the turn reaches the server after it.
      const later = vi.fn(through);
      vi.stubGlobal('fetch', later);
      expect(await session.store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
      expect(later).not.toHaveBeenCalled();
    }));

  it('stops a reply while its try waits to be sent again, and sends nothing more', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = await chatSaid(session);
      const log = stubRelay(() => new Response('{}', { status: 429, headers: { [RELAY_HEADER]: 'upstream', 'retry-after': '30' } }));
      const turning = takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(session.talk.snapshot(chat)?.retrying).toBe(true));
      session.talk.stop(chat);
      expect(await turning).toBeNull();
      expect(replies(session, chat)[0]!.receipt).toMatchObject({ state: 'cut', cut: 'stopped', error: null });
      expect(log).toHaveLength(1);
    }));

  it('keeps a batch answer made before 멈추기 canceled it, the reply saying it stops meanwhile', () =>
    server.withSession(async (session) => {
      const message = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: '반가워요' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
      const log = await batching(session, ['ended'], { type: 'succeeded', message });
      const chat = await chatSaid(session);
      const turning = takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(session.talk.snapshot(chat)?.batch).toBe(true));
      session.talk.stop(chat);
      expect(session.talk.snapshot(chat)?.stopping).toBe(true);
      expect(await turning).toBeNull();
      expect(replies(session, chat)[0]).toMatchObject({ text: '반가워요', receipt: { state: 'done', discount: 'batch' } });
      expect(log.map(({ sent }) => sent.url).slice(-3)).toEqual(['https://api.anthropic.com/v1/messages/batches/b1/cancel', 'https://api.anthropic.com/v1/messages/batches/b1', 'https://api.anthropic.com/v1/messages/batches/b1/results']);
      expect(session.store.list('stream')).toEqual([]);
    }));

  it('ends a turn waiting on a batch once a restore ends its store, canceling the batch', () =>
    server.withSession(async (session) => {
      const log = await batching(session, ['canceling'], null);
      const chat = await chatSaid(session);
      const turning = takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(session.talk.snapshot(chat)?.batch).toBe(true));
      const through = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url.startsWith('/api/objects?') ? (vi.stubGlobal('fetch', through), Promise.resolve(Response.json({ error: 'cache-reset' }, { status: 409 }))) : through(url, init)));
      void session.store.pull();
      expect(await turning).toEqual({ kind: 'unsaved', reply: null, failure: { ok: false, error: 'timeline-changed' } });
      await vi.waitFor(() => expect(log.map(({ sent }) => sent.url)).toContain('https://api.anthropic.com/v1/messages/batches/b1/cancel'));
    }));

  it('keeps what each call sent, its address and body and never its headers, through an edit and while its chat is held', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      stubRelay(() => saying('반가워요'));

      await takeTurn(session, chat, { kind: 'answer' });
      const message = () => fold(session.store.children('entry', chat))[1]!;
      const call = shown(message()).receipt!.id;
      expect(session.log.entry(chat, call)?.request).toEqual({ url: 'https://openrouter.ai/api/v1/chat/completions', body: expect.stringContaining('"content":"안녕"') });
      // An edit (a person's, or a bot's onOutput) is a version of its own that keeps the call's receipt.
      await editMessage(session.store, chat, message(), '반가워요!', null);
      expect(shown(message()).id).not.toBe(call);
      expect(shown(message()).receipt!.id).toBe(call);
      expect(session.log.entry(chat, call)).not.toBeNull();
      lease.release();
      await vi.waitFor(() => expect(session.store.scopeState(chat)).toBe('unloaded'));
      expect(session.log.entry(chat, call)).toBeNull();
    }));

  it('attaches the sent wire and an asynchronous break diagnosis, without diagnosing an intact send', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await session.store.update('profile', FIRST_PROFILE_ID, (current) => ({ ...current, settings: { cache: '5m' } }));
      const chat = await chatSaid(session);
      const usage = { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 50 } };
      stubRelay(() => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'reply' }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`, { headers: { [RELAY_HEADER]: 'upstream' } }));
      const run = session.store.evaluation.cacheDiagnosis.bind(session.store.evaluation);
      let finish!: () => void;
      const waiting = new Promise<void>((resolve) => { finish = resolve; });
      const diagnose = vi.spyOn(session.store.evaluation, 'cacheDiagnosis').mockImplementation(async (...args) => { await waiting; return run(...args); });
      await takeTurn(session, chat, { kind: 'answer' });
      await takeTurn(session, chat, { kind: 'answer' });
      expect(diagnose).not.toHaveBeenCalled();
      const first = replies(session, chat).at(-1)!.receipt!;
      const old = session.log.entry(chat, first.id)!;
      expect(old.wire?.some(({ content }) => content === '안녕')).toBe(true);
      await editMessage(session.store, chat, fold(session.store.children('entry', chat))[0]!, 'changed message', null);
      await takeTurn(session, chat, { kind: 'answer' });
      const last = replies(session, chat).at(-1)!.receipt!;
      expect(session.log.entry(chat, last.id)?.diagnosis).toBeUndefined();
      finish();
      await vi.waitFor(() => expect(session.log.entry(chat, last.id)?.diagnosis).toMatchObject({ missing: 0, parts: expect.arrayContaining([expect.objectContaining({ kind: 'changed', causes: [{ kind: 'edited' }] })]) }));
      expect(diagnose).toHaveBeenCalledTimes(1);
      expect(old.wire?.some(({ content }) => content === '안녕')).toBe(true);
    }));

  it('keeps on each receipt what its send expected from the cache, and stores the call so a forecast survives a reload', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await session.store.update('profile', FIRST_PROFILE_ID, (current) => ({ ...current, settings: { cache: '5m' } }));
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const usage = { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 50 } };
      const cached = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`, { headers: { [RELAY_HEADER]: 'upstream' } });
      stubRelay(inTurn([cached('반가워요'), cached('또 반가워요'), upstream(400, { error: { message: 'bad' } })]));
      const receipts = () => fold(session.store.children('entry', chat)).filter(({ role }) => role === 'assistant').map((message) => shown(message).receipt!);

      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      expect(receipts()[0]!.forecast).toBeUndefined();
      expect(chatPrint(session.store, chat)?.value).toMatchObject({ call: receipts()[0]!.id, model: 'm', messages: expect.arrayContaining([expect.objectContaining({ point: true })]) });
      expect(await takeTurn(session, chat, { kind: 'send', text: '또 안녕' })).toBeNull();
      expect(receipts()[1]!.forecast).toMatchObject({ broken: null });
      expect(receipts()[1]!.forecast!.read).toBeGreaterThan(0);
      expect(chatPrint(session.store, chat)?.value.call).toBe(receipts()[1]!.id);
      // A call that kept no cache leaves the print on the one lastCache still names.
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      expect(receipts()[2]!.state).toBe('failed');
      expect(chatPrint(session.store, chat)?.value.call).toBe(receipts()[1]!.id);

      lease.release();
      await vi.waitFor(() => expect(session.store.scopeState(chat)).toBe('unloaded'));
      await server.hold(session.store, chat);
      const messages = session.read.chat(chat).snapshot()!.messages;
      const sending = (await wouldSend(session, chat, { kind: 'send', text: '셋' }))!;
      const against = forecast(prior(session.store, chat, messages, Date.now()), cacheSend(sending, null)!)!.against!;
      expect(against).toEqual({ read: against.of, of: against.of, broken: null });
      expect(against.of).toBeGreaterThan(receipts()[1]!.forecast!.of);
    }));

  it('saves what the model thought beside the reply, never inside its text', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      const events = [{ choices: [{ delta: { reasoning: '인사를 받았다.' } }] }, { choices: [{ delta: { content: '반가워요' }, finish_reason: 'stop' }] }];
      stubRelay(() => new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'x-relay': 'upstream' } }));

      await takeTurn(session, chat, { kind: 'answer' });
      expect(shown(fold(session.store.children('entry', chat))[1]!)).toMatchObject({ text: '반가워요', reasoning: '인사를 받았다.' });
    }));

  it('cues a reply as its text follows its reasoning and once it is received, but not one 멈추기 stopped', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = await chatSaid(session);
      const heard: string[] = [];
      session.cues.subscribe((cue) => heard.push(cue === 'reply-started' ? `${cue}: ${session.talk.snapshot(chat)?.reasoning}` : cue));
      stubRelay(() => new Response('{}', { status: 429, headers: { [RELAY_HEADER]: 'upstream', 'retry-after': '30' } }));
      const stopped = takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(session.talk.snapshot(chat)?.retrying).toBe(true));
      session.talk.stop(chat);
      await stopped;
      const events = [{ choices: [{ delta: { reasoning: '인사를 받았다.' } }] }, { choices: [{ delta: { content: '반가' } }] }, { choices: [{ delta: { content: '워요' }, finish_reason: 'stop' }] }];
      stubRelay(() => new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { [RELAY_HEADER]: 'upstream' } }));

      await takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(heard).toEqual(['reply-started: 인사를 받았다.', 'reply-received']));
    }));

  it('ends a turn whose prepare throws, so the next one runs', () =>
    server.withSession(async (session) => {
      const turn = { chat: crypto.randomUUID(), said: null, reply: { id: 'r', message: null, replaces: null, continues: null } };
      await expect(session.talk.run(turn, () => Promise.reject(new Error('prepare broke')))).rejects.toThrow('prepare broke');
      expect(session.talk.snapshot(turn.chat)).toBeNull();
      expect(await session.talk.run(turn, async () => ({ kind: 'probe' }))).toEqual({ kind: 'probe' });
    }));

  it('runs one turn per chat at once and stops only the chat it is asked to', () =>
    server.withSession(async (session) => {
      const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
      const turn = (chat: string) => ({ chat, said: null, reply: { id: crypto.randomUUID(), message: null, replaces: null, continues: null } });
      const held = (signal: AbortSignal) => new Promise<{ kind: 'stopped' }>((done) => {
        if (signal.aborted) done({ kind: 'stopped' });
        signal.addEventListener('abort', () => done({ kind: 'stopped' }));
      });
      const first = session.talk.run(turn(a), held);
      const second = session.talk.run(turn(b), held);
      expect(session.talk.snapshot(a)?.chat).toBe(a);
      expect(session.talk.snapshot(b)?.chat).toBe(b);
      expect([...session.talk.writing()]).toEqual([a, b]);
      expect(await session.talk.run(turn(a), held)).toBeNull();
      session.talk.stop(a);
      expect(await first).toEqual({ kind: 'stopped' });
      expect(session.talk.snapshot(a)).toBeNull();
      expect(session.talk.snapshot(b)?.chat).toBe(b);
      expect([...session.talk.writing()]).toEqual([b]);
      session.talk.stop(b);
      expect(await second).toEqual({ kind: 'stopped' });
    }));
});
