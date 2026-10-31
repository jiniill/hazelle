import { describe, expect, it, vi } from 'vitest';
import { resolveConnection } from '../connectors/registry';
import type { Connection } from '../connectors/types';
import { firstTurns } from '../model/turns';
import { appendUserMessage, startChat } from './chat-log';
import { fetchApi } from './api';
import { editPersona } from './personas';
import { autoDiagnose, setDiagnosisSharing } from './auto-diagnosis';
import { setPulseSharing } from './pulse';
import { stubRelay, testServer, upstream } from './testing';

const server = testServer();

const copilot: Connection = { type: 'copilot', label: 'Copilot', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'gho_x', name: 'jin' }], turns: firstTurns('group', 'key'), starred: [] };
const USER = 'https://api.github.com/copilot_internal/user';
const EXCHANGE = 'https://api.github.com/copilot_internal/v2/token';
const MODELS = 'https://api.githubcopilot.com/models';
const unlimited = { quota_snapshots: { premium_interactions: { unlimited: true } } };

describe('session', () => {
  it('drops its tokens and model lists on close, and keeps none from a trade answered after it', () =>
    server.withSession(async (session) => {
      // The session closes while the second trade is on its way, so its answer arrives after close.
      const log = stubRelay(({ url, headers }) => {
        if (headers.authorization === 'Bearer gho_other') session.close();
        return url === EXCHANGE ? upstream(200, { token: 'tid', expires_at: Math.floor(Date.now() / 1000) + 1800 }) : upstream(200, url === USER ? unlimited : { data: [] });
      });
      const resolved = resolveConnection(copilot)!;
      expect(await session.credentials.get(resolved, copilot.accounts[0]!.secret)).toEqual({ ok: true, credential: 'tid' });
      expect(await session.catalogs.load(copilot)).toEqual({ ok: true, models: [] });

      const trading = session.credentials.get(resolved, 'gho_other');
      const stopped = { ok: false, failure: { kind: 'stopped' } };
      expect(await trading).toEqual(stopped);
      expect(await session.credentials.get(resolved, copilot.accounts[0]!.secret)).toEqual(stopped);
      expect(await session.catalogs.load(copilot)).toEqual(stopped);
      expect(log.map((call) => call.sent.url)).toEqual([EXCHANGE, USER, MODELS, EXCHANGE]);
    }));

  it('opens with each sort’s default prompt', () =>
    server.withSession(async (session) => {
      const prompts = session.read.kind('prompt').snapshot();
      const settings = session.read.settings.snapshot();
      const named = (id: string | undefined) => prompts.find((prompt) => prompt.id === id)?.value.name;
      expect([prompts.length, named(settings.prompt), named(settings.translatePrompt), named(settings.memoryPrompt), named(settings.illustratePrompt), named(settings.mascotPrompt)]).toEqual([5, '기본 대화', '기본 번역', '기본 기억', '기본 삽화', '기본 마스코트']);
    }));

  it('gives the same summaries until the store changes', () =>
    server.withSession(async (session) => {
      const first = session.read.chats.snapshot();
      expect(session.read.chats.snapshot()).toBe(first);
      const chat = await session.store.create('chat', { title: null, character: null, models: {} });
      const next = session.read.chats.snapshot();
      expect(next).not.toBe(first);
      expect(next.map((item) => item.id)).toEqual([chat.ok && chat.data.id]);
      expect(session.read.chats.snapshot()).toBe(next);
    }));

  it("updates a chat's preview when its messages or its persona dependency change", () =>
    server.withSession(async (session) => {
      const { store } = session;
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: '{{user}}, hello' });
      expect(session.read.chat(chat).snapshot()?.preview).toBe('jin, hello');
      await editPersona(store, store.get('chat', chat)!.value.persona!, { name: 'Mina' });
      expect(session.read.chat(chat).snapshot()?.preview).toBe('Mina, hello');
      await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: 'bye, {{user}}' });
      expect(session.read.chat(chat).snapshot()?.preview).toBe('bye, Mina');
    }));

  it('sends the page-load mark once and labels calls only while the account’s switch is on, and none once closed', async () => {
    const label = { kind: 'call', role: 'chat', type: 'openai', model: 'gpt-5' } as const;
    const sent: (string | undefined)[] = [];
    const call = () => fetchApi('objects?since=0', { pulse: label });
    await server.withSession(async (session) => {
      const fetch = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
        sent.push((init.headers as Record<string, string>)['x-hazelle-pulse']);
        return fetch(url, init);
      });
      await session.store.pull();
      await session.store.pull();
      await setPulseSharing(session.store, false);
      await call();
      await setPulseSharing(session.store, true);
      await call();
    });
    await call();
    expect(sent).toEqual(['seen', undefined, undefined, undefined, undefined, 'chat openai gpt-5', undefined]);
  });

  it('sends an automatic report only while an account’s switch is on, and none once closed', async () => {
    const sent: string[] = [];
    const reported = () => sent.filter((url) => url === '/api/diagnoses').length;
    await server.withSession(async (session) => {
      const fetch = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
        sent.push(url);
        return fetch(url, init);
      });
      await setDiagnosisSharing(session.store, false);
      autoDiagnose({ event: 'turn-failed', detail: 'gone' });
      expect(reported()).toBe(0);
      await setDiagnosisSharing(session.store, true);
      autoDiagnose({ event: 'turn-failed', detail: 'gone' });
      expect(reported()).toBe(1);
    });
    autoDiagnose({ event: 'turn-failed', detail: 'unsent' });
    expect(reported()).toBe(1);
  });
});
