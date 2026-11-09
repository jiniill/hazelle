import { afterEach, describe, expect, it, vi } from 'vitest';
import { fold } from '../model/chat';
import { vectorsId } from '../model/memory';
import { setDefaultModel } from './assignment';
import { startChat } from './chat-log';
import { createCharacter, editCharacter } from './characters';
import { projectGreetings } from './greetings';
import type { Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import { takeTurn } from './turn';
import { wouldSend } from './turn-context';

const server = testServer();
afterEach(() => vi.restoreAllMocks());

const embedding = (...vectors: number[][]) => upstream(200, { data: vectors.map((embedding, index) => ({ index, embedding })), usage: { prompt_tokens: vectors.length } });
const inputOf = (sent: { body?: string | null }) => JSON.parse(sent.body!).input;

async function lighthouse(session: Session, embed: boolean) {
  await answerable(session);
  if (embed) await setDefaultModel(session.store, 'embed', { connection: session.store.list('connection')[0]!.id, model: 'm' });
  const character = crypto.randomUUID();
  await createCharacter(session.store, 'Luna', character);
  await editCharacter(session.store, character, { description: 'Luna keeps the lighthouse.', additionalText: 'The lamp.\n\nThe pier.\n\n\n\nThe boats.\n\nThe storm.' });
  const open = async () => {
    const chat = crypto.randomUUID();
    await server.hold(session.store, chat);
    await startChat(session.store, chat, { title: null, character, models: {} }, projectGreetings(['Welcome.'], [crypto.randomUUID()], 0));
    return chat;
  };
  return { character, open };
}

describe('additionalText', () => {
  it('sends the three paragraphs nearest the opening past the greeting after the description, each paragraph embedded once for the character', () =>
    server.withSession(async (session) => {
      const { character, open } = await lighthouse(session, true);
      const chat = await open();
      const log = stubRelay(inTurn([embedding([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0.8, 0.6]), embedding([0.1, 1, 0]), saying('Hi.')]));
      expect(await takeTurn(session, chat, { kind: 'send', text: 'Tell me of the pier.' })).toBeNull();
      expect(inputOf(log[0]!.sent)).toEqual(['The lamp.', 'The pier.', 'The boats.', 'The storm.']);
      expect(inputOf(log[1]!.sent)).toEqual([expect.stringMatching(/^.+: Tell me of the pier\.$/)]);
      const sent: { content: string }[] = JSON.parse(log[2]!.sent.body!).messages;
      expect(sent.some(({ content }) => content.includes('Luna keeps the lighthouse.\n\nThe pier.\n\nThe storm.\n\nThe lamp.'))).toBe(true);
      expect(Object.keys(session.store.get('vectors', vectorsId(character))!.value.items)).toHaveLength(4);

      // Asked with the same opening, a forecast sends what the send found, and the next send asks for nothing.
      const reply = fold(session.store.children('entry', chat)).at(-1)!;
      const forecast = await wouldSend(session, chat, { kind: 'regenerate', message: reply.id });
      expect(forecast?.prompt.messages.some(({ content }) => content.includes('The pier.\n\nThe storm.\n\nThe lamp.'))).toBe(true);
      const regenerated = stubRelay(inTurn([saying('Hi again.')]));
      expect(await takeTurn(session, chat, { kind: 'regenerate', message: reply.id })).toBeNull();
      expect(regenerated).toHaveLength(1);

      const again = stubRelay(inTurn([embedding([0, 0, 1]), saying('Hello.')]));
      expect(await takeTurn(session, await open(), { kind: 'send', text: 'And the boats?' })).toBeNull();
      expect(again).toHaveLength(2);
      expect(inputOf(again[0]!.sent)).toEqual([expect.stringMatching(/: And the boats\?$/)]);
    }));

  it('stops the send without an 임베딩 모델, before any call', () =>
    server.withSession(async (session) => {
      const { open } = await lighthouse(session, false);
      const chat = await open();
      const log = stubRelay(inTurn([saying('Hi.')]));
      expect(await takeTurn(session, chat, { kind: 'send', text: 'Hello.' })).toMatchObject({ kind: 'additional', failure: { kind: 'no-model' } });
      expect(log).toHaveLength(0);
    }));
});
