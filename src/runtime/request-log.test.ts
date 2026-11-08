import { describe, expect, it } from 'vitest';
import type { Receipt } from '../model/chat';
import { chatModel } from './assignment';
import { appendUserMessage, startChat } from './chat-log';
import { redacted, REQUEST_LOG_LIMITS, type LogEntry } from './request-log';
import { pageAnswer } from './talk';
import { answerable, saying, stubRelay, testConnection, testLog, testServer } from './testing';
import { takeTurn } from './turn';

const server = testServer();

const entry = (chat: string, id: string, body = ''): LogEntry => ({ chat, purpose: 'reply', at: 0, picked: false, receipt: { id } as Receipt, request: { url: 'https://x.test/v1', body }, response: null });

describe('the request log', () => {
  it('records every model call under its chat with its purpose, a reply with the prompt it was assembled from', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      stubRelay(() => saying('반가워요'));
      await takeTurn(session, chat, { kind: 'answer' });
      const route = chatModel(session.store, session.store.get('chat', chat)!.value, 'main');
      if ('kind' in route) throw new Error(route.kind);
      await pageAnswer(session, { route, settings: {} }, 'mascot', chat, [{ role: 'user', content: '한마디' }], new AbortController().signal);
      const { entries } = session.log.of(chat);
      expect(entries.map(({ purpose, receipt }) => [purpose, receipt.state])).toEqual([['reply', 'done'], ['mascot', 'done']]);
      expect(entries[0]!.prompt?.messages.at(-1)).toMatchObject({ content: '안녕' });
      expect(entries[0]!.wire?.at(-1)).toMatchObject({ content: '안녕' });
      expect(entries[0]!.diagnosis).toBeNull();
      expect(entries[1]!.prompt).toBeUndefined();
      lease.release();
    }));

  it('hides a credential in the address and an account secret anywhere in the request', () => {
    const connection = { ...testConnection, accounts: [{ id: 'a', secret: 'sk-or-x' }] };
    expect(redacted({ url: 'https://me:pw@x.test/v1?key=abc&alt=sse', body: '{"note":"sk-or-x"}' }, connection)).toEqual({ url: 'https://REDACTED@x.test/v1?key=REDACTED&alt=sse', body: '{"note":"REDACTED"}' });
  });

  it('keeps a chat’s entries after the chat closes, letting the chat written least recently go past the page bound', () =>
    server.withSession(async (session) => {
      const lease = session.store.retainChat('a', { created: true });
      await lease.ready;
      session.log.record(entry('a', '1'));
      lease.release();
      expect(session.log.entry('a', '1')).not.toBeNull();
      const chunk = 'x'.repeat(REQUEST_LOG_LIMITS.page / 3);
      session.log.record(entry('b', '2', chunk));
      session.log.record(entry('c', '3', chunk));
      session.log.record(entry('a', '4', 'y'));
      session.log.record(entry('d', '5', chunk));
      expect(['a', 'b', 'c', 'd'].map((chat) => session.log.of(chat).entries.length)).toEqual([2, 0, 1, 1]);
    }));

  it('counts attached wire text and diagnosis when trimming and never reattaches an evicted call', () => {
    const log = testLog();
    log.record(entry('a', 'old', 'x'.repeat(REQUEST_LOG_LIMITS.characters - 100)));
    log.record(entry('a', 'new'));
    log.attach('a', 'new', { wire: [{ content: 'w'.repeat(200), index: 3 }] });
    expect(log.of('a').omitted).toBe(1);
    expect(log.entry('a', 'new')!.wire).toEqual([{ content: 'w'.repeat(200), index: 3 }]);
    log.attach('a', 'old', { wire: [{ content: 'gone', index: 0 }] });
    expect(log.entry('a', 'old')).toBeNull();
    log.record(entry('a', 'latest'));
    log.attach('a', 'latest', { diagnosis: { missing: 0, parts: [{ kind: 'added', role: 'user', from: { kind: 'answer' }, before: null, after: 0, causes: [{ kind: 'unknown' }], diff: { coarse: true, runs: [{ kind: 'after', text: 'd'.repeat(REQUEST_LOG_LIMITS.characters) }] } }] } });
    expect(log.of('a').entries.map(({ receipt }) => receipt.id)).toEqual(['latest']);
    expect(log.of('a').omitted).toBe(2);
  });

  it('keeps a bounded number of entries per chat, counting what it let go, and always the newest', () => {
    const log = testLog();
    for (let index = 0; index <= REQUEST_LOG_LIMITS.entries; index++) log.record(entry('a', String(index)));
    expect(log.of('a')).toMatchObject({ entries: { length: REQUEST_LOG_LIMITS.entries }, omitted: 1 });
    log.record(entry('a', 'huge', 'x'.repeat(REQUEST_LOG_LIMITS.characters + 1)));
    expect(log.of('a').entries.map(({ receipt }) => receipt.id)).toEqual(['huge']);
  });
});
