import { describe, expect, it, vi } from 'vitest';
import { RELAY_HEADER } from '../contracts/http';
import { fold, shown } from '../model/chat';
import { setAgentAt } from './agents';
import { setTranslate } from './characters';
import { appendUserMessage, editMessage, restoreRaw, startChat } from './chat-log';
import { addAgent, editPrompt } from './prompts';
import type { Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import { polishAgain, takeTurn } from './turn';
import { changeSettings } from './account-settings';

const server = testServer();

async function chatted(session: Session) {
  await answerable(session);
  await changeSettings(session.store, (current) => ({ ...current, labs: ['agents'] }));
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'She opens the door.' });
  return chat;
}

async function agent(session: Session, start: Parameters<typeof addAgent>[1], name: string) {
  const made = await addAgent(session.store, start, name);
  if (!made.ok) throw new Error(made.error);
  return made.data.id;
}

const messages = (session: Session, chat: string) => fold(session.store.children('entry', chat));
const body = (log: ReturnType<typeof stubRelay>, at: number) => log[at]!.sent.body!;

describe('에이전트', () => {
  it('runs a pre agent before the reply, puts its note after the chat in a prompt without the slot, and reuses it on 다시 생성', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setAgentAt(session.store, { kind: 'settings' }, await agent(session, 'scene', '장면'), true);
      const log = stubRelay(inTurn([saying('NOTE: the room is dark.'), saying('The reply.'), saying('Again.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      expect(body(log, 0)).toContain('You plan the next reply');
      expect(body(log, 0)).toContain('She opens the door.');
      expect(body(log, 1)).toContain('[장면]\\nNOTE: the room is dark.');
      const reply = messages(session, chat)[1]!;
      expect(shown(reply).receipt?.agents).toMatchObject([{ name: '장면', stage: 'pre', note: 'NOTE: the room is dark.' }]);

      expect(await takeTurn(session, chat, { kind: 'regenerate', message: reply.id })).toBeNull();
      expect(log).toHaveLength(3);
      expect(body(log, 2)).toContain('NOTE: the room is dark.');
      expect(shown(messages(session, chat)[1]!).receipt?.agents).toMatchObject([{ note: 'NOTE: the room is dark.', reused: true }]);
    }));

  it('makes the notes anew when asked, and names the agent and its stage in the request log', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setAgentAt(session.store, { kind: 'settings' }, await agent(session, 'scene', '장면'), true);
      const log = stubRelay(inTurn([saying('NOTE: dark.'), saying('The reply.'), saying('NOTE: lit.'), saying('Again.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      const reply = messages(session, chat)[1]!;
      expect(await takeTurn(session, chat, { kind: 'regenerate', message: reply.id }, null, { notes: true })).toBeNull();
      expect(log).toHaveLength(4);
      expect(body(log, 3)).toContain('NOTE: lit.');
      expect(shown(messages(session, chat)[1]!).receipt?.agents).toMatchObject([{ note: 'NOTE: lit.' }]);
      const logged = session.log.of(chat).entries.filter((entry) => entry.purpose === 'agent');
      expect(logged).toHaveLength(2);
      expect(logged[0]!.agent).toMatchObject({ name: '장면', stage: 'pre' });
      expect(logged[0]!.agent!.sent.parts.map(({ from }) => from.kind === 'block' && from.slot)).toContain('source');
    }));

  it('stops the turn when a pre agent fails, and sends without it when asked', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setAgentAt(session.store, { kind: 'chat', id: chat }, await agent(session, 'scene', '장면'), true);
      const log = stubRelay(inTurn([upstream(400, { error: { message: 'bad request' } }), saying('The reply.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toMatchObject({ kind: 'agent', failure: { name: '장면', failure: { kind: 'failed' } } });
      expect(await takeTurn(session, chat, { kind: 'answer' }, null, { agents: true })).toBeNull();
      expect(log).toHaveLength(2);
      expect(shown(messages(session, chat)[1]!).text).toBe('The reply.');
    }));

  it('names a pre agent whose call is sent again while the reply waits for it', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setAgentAt(session.store, { kind: 'chat', id: chat }, await agent(session, 'scene', '장면'), true);
      stubRelay(() => new Response('{}', { status: 429, headers: { [RELAY_HEADER]: 'upstream', 'retry-after': '30' } }));
      const turning = takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(session.talk.snapshot(chat)?.preparing).toEqual({ step: 'agents', running: ['장면'], retrying: ['장면'], total: 1 }));
      session.talk.stop(chat);
      await turning;
    }));

  it('rewrites a saved reply in its place, keeps the raw text, and 원문으로 되돌리기 brings it back', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setAgentAt(session.store, { kind: 'chat', id: chat }, await agent(session, 'polish', '다듬기'), true);
      const log = stubRelay(inTurn([saying('The door, the door, it opens.'), saying('The door opens.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(shown(messages(session, chat)[1]!).text).toBe('The door opens.'), { timeout: 5000 });
      expect(body(log, 1)).toContain('The door, the door, it opens.');
      const reply = messages(session, chat)[1]!;
      expect(reply.versions).toHaveLength(1);
      expect(shown(reply)).toMatchObject({ raw: 'The door, the door, it opens.', receipt: { agents: [{ name: '다듬기', stage: 'post' }] } });

      expect((await restoreRaw(session.store, chat, reply)).ok).toBe(true);
      expect(shown(messages(session, chat)[1]!).text).toBe('The door, the door, it opens.');
    }));

  it('polishes again from the raw text in place of the last polish, and reads a hand edit after it as retouched', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setAgentAt(session.store, { kind: 'chat', id: chat }, await agent(session, 'polish', '다듬기'), true);
      const log = stubRelay(inTurn([saying('The door, the door, it opens.'), saying('The door opens.'), saying('A door opens.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(shown(messages(session, chat)[1]!).text).toBe('The door opens.'), { timeout: 5000 });
      const polished = messages(session, chat)[1]!;
      await polishAgain(session, chat, polished.id, shown(polished).id);
      expect(body(log, 2)).toContain('The door, the door, it opens.');
      const again = shown(messages(session, chat)[1]!);
      expect(again).toMatchObject({ text: 'A door opens.', raw: 'The door, the door, it opens.' });
      expect(again.receipt?.agents).toHaveLength(1);
      expect(again.retouched).toBeUndefined();

      expect((await editMessage(session.store, chat, messages(session, chat)[1]!, 'A red door opens.', null)).ok).toBe(true);
      expect(shown(messages(session, chat)[1]!)).toMatchObject({ raw: 'The door, the door, it opens.', retouched: true });
    }));

  it('translates the rewritten reply, not the raw one', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setTranslate(session.store, null, { replies: true });
      await setAgentAt(session.store, { kind: 'chat', id: chat }, await agent(session, 'polish', '다듬기'), true);
      stubRelay(inTurn([saying('The door, the door, it opens.'), saying('The door opens.'), saying('문이 열린다.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(shown(messages(session, chat)[1]!)).toMatchObject({ text: 'The door opens.', translation: { text: '문이 열린다.' } }), { timeout: 5000 });
    }));

  it('adds a post agent\'s answer after the reply and gives it its memory on the next reply', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      const id = await agent(session, 'post', '상태');
      const prompt = session.store.get('prompt', id)!.value;
      await editPrompt(session.store, id, { blocks: [...prompt.blocks, { id: crypto.randomUUID(), name: null, kind: 'slot', slot: 'agentMemory', role: 'system', wrapper: null }] });
      await session.store.update('prompt', id, (current) => ({ ...current, place: 'after' as const }));
      await setAgentAt(session.store, { kind: 'chat', id: chat }, id, true);
      const log = stubRelay(inTurn([saying('The reply.'), saying('[HP 10]<memory>HP 10</memory>'), saying('Next.'), saying('[HP 9]<memory>HP 9</memory>')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(shown(messages(session, chat)[1]!).text).toBe('The reply.\n\n[HP 10]'), { timeout: 5000 });
      expect(body(log, 1)).toContain('It is empty so far.');

      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(shown(messages(session, chat)[3]!).text).toBe('Next.\n\n[HP 9]'), { timeout: 5000 });
      expect(body(log, 3)).toContain('It stands now as:\\n---\\nHP 10');
    }));
});
