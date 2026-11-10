import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../../model/chat';
import { setIllustrate } from '../library/characters';
import { appendUserMessage, startChat } from '../chat/chat-log';
import { setFeatureAt } from './features';
import type { Session } from '../session';
import { answerable, inTurn, saying, stubRelay, testServer } from '../testing';
import { takeTurn } from '../chat/turn';

const server = testServer();

const REPLY = '그녀가 문을 열었다. 방은 어두웠다.';
const answer = (expression: string, line: string) => saying(JSON.stringify({ expression, line }));

async function chatted(session: Session) {
  await answerable(session);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
  return chat;
}

describe('Commentator', () => {
  it('writes a line for a reply received with the mascot on, its call in the ledger, and a later line of the version replaces it', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      await setFeatureAt(session.store, { kind: 'settings' }, 'mascot', true);
      const log = stubRelay(inTurn([saying(REPLY), answer('surprised', '어머, 문을 연 것이와요!'), answer('smug', '흥.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      // The reply's save, the bot's onOutput, the evaluation and the call run in turn.
      await vi.waitFor(() => {
        expect(session.store.children('remark', chat)).toHaveLength(1);
        expect(session.commentator.snapshot().size).toBe(0);
      }, { timeout: 5000 });
      const reply = fold(session.store.children('entry', chat))[1]!;
      const { value } = session.store.children('remark', chat)[0]!;
      expect(value).toMatchObject({ message: reply.id, version: shown(reply).id, mascot: 'yeongae', expression: 'surprised', line: '어머, 문을 연 것이와요!', receipt: { state: 'done' } });
      expect(log[1]!.sent.body).toContain(REPLY);
      expect(log[1]!.sent.body).toContain('You are 영애');
      const ledger = await session.usage.read(new AbortController().signal);
      expect(ledger.ok && ledger.data.some(({ call }) => call.id === value.receipt.id)).toBe(true);

      session.commentator.comment(chat, reply.id, shown(reply).id);
      await vi.waitFor(() => expect(session.store.children('remark', chat).map(({ value }) => [value.expression, value.line])).toEqual([['calm', '흥.']]), { timeout: 5000 });
    }));

  it('says nothing on a reply while the mascot is off, as it starts', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      // 자동 삽화 with no image model: its slot appears in the same step that would start the mascot's line.
      await setIllustrate(session.store, null, { auto: true });
      const log = stubRelay(inTurn([saying(REPLY)]));
      await takeTurn(session, chat, { kind: 'answer' });
      await vi.waitFor(() => expect(session.illustrator.snapshot().size).toBe(1), { timeout: 5000 });
      expect(session.commentator.snapshot().size).toBe(0);
      expect(log).toHaveLength(1);
      expect(session.store.children('remark', chat)).toEqual([]);
    }));
});
