import { describe, expect, it } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { fold, shown, statusChanges, type Receipt } from '../../model/chat';
import type { StatusDefinition } from '../../model/status';
import { scopeOf } from '../chat/chat-context';
import { appendUserMessage, startChat, type Written } from '../chat/chat-log';
import { withTurn } from '../chat/talk';
import { takeTurn } from '../chat/turn';
import { switchLab } from '../library/prompts';
import type { Session } from '../session';
import { answerable, inTurn, saying, stubRelay, testServer } from '../testing';
import { cutStatus } from './status';

const server = testServer();

const definition: StatusDefinition = {
  id: 'd',
  name: '기본',
  writer: 'with',
  fields: [{ id: 'hp', name: 'HP', kind: 'gauge', min: 0, max: 10, start: 5 }, { id: 'place', name: '장소', kind: 'text' }],
  groups: [],
  logs: [],
};

// A chat of a character whose card declares the state, with 상태's 실험실 switch on and the user's first message said.
async function chatOf(session: Session, status: StatusDefinition = definition) {
  await switchLab(session.store, 'status', true);
  const character = await session.store.create('character', { card: { ...blankCard('루나'), status }, folder: null, loreFolders: [], modules: [] });
  if (!character.ok) throw new Error(character.error);
  const id = crypto.randomUUID();
  await server.hold(session.store, id);
  const chat = { title: null, character: character.data.id, models: {} };
  await startChat(session.store, id, chat, null);
  await appendUserMessage(session.store, id, { id: crypto.randomUUID(), text: '안녕' });
  return { id, chat };
}

const messages = (session: Session, chat: string) => fold(session.store.children('entry', chat));
const set = (field: string, value: number | string) => ({ definition: 'd', kind: 'set' as const, field, value });

describe('a reply written with its state', () => {
  it('has its block cut from the text it is saved with and kept as its changes, which the next turn is told', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const { id, chat } = await chatOf(session);
      stubRelay(inTurn([saying('반가워요.\n<status>\nHP: 7\n', '장소: 등대\n</status>'), saying('네.')]));

      await takeTurn(session, id, { kind: 'answer' });
      const reply = shown(messages(session, id)[1]!);
      expect(reply.text).toBe('반가워요.');
      expect(reply.status).toMatchObject([{ of: ['d'], changes: [set('hp', 7), set('place', '등대')], receipt: null }]);
      expect(scopeOf(session, id, chat, messages(session, id)).status.state).toEqual({ d: { values: { hp: 7, place: '등대' }, groups: {}, logs: {} } });

      // A reply with no block changes nothing and says so, never guessed.
      await takeTurn(session, id, { kind: 'answer' });
      expect(shown(messages(session, id)[2]!)).toMatchObject({ text: '네.', status: [{ of: ['d'], changes: [], missed: true }] });
      expect(statusChanges(messages(session, id))).toEqual([set('hp', 7), set('place', '등대')]);
    }));

  it('keeps its text whole in a chat that asks for no block, and writes nothing when it did not end whole', () =>
    server.withSession(async (session) => {
      const receipt = (state: Receipt['state']): Receipt => ({ id: crypto.randomUUID(), connection: 'c', source: 'S', model: 'm', modelName: 'M', state, cut: state === 'cut' ? 'length' : null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: null, totalMs: 1, cache: null });
      const written = (state: Receipt['state']): Written => ({ id: crypto.randomUUID(), message: null, replaces: null, at: 1, text: '답.\n<status>\nHP: 9\n</status>', receipt: receipt(state) });
      const after = await chatOf(session, { ...definition, writer: 'after' });
      const whole = written('done');
      expect(cutStatus(session.store, after.id, whole)).toBe(whole);

      const { id } = await chatOf(session);
      expect(cutStatus(session.store, id, written('done'))).toMatchObject({ text: '답.', status: { changes: [set('hp', 9)] } });
      const cut = cutStatus(session.store, id, { ...written('cut'), text: '답.\n<status>\nHP: 9' });
      expect([cut.text, cut.status]).toEqual(['답.', undefined]);
    }));
});

describe('withTurn', () => {
  it('shows a reply being written without the block it ends with, in a chat that cuts it', () => {
    const turn = { chat: 'c', said: null, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '반가워요.\n<status>\nHP: 7', reasoning: '' };
    expect(shown(withTurn([], { ...turn, status: true }, 'c')[0]!).text).toBe('반가워요.');
    expect(shown(withTurn([], turn, 'c')[0]!).text).toBe(turn.text);
  });
});
