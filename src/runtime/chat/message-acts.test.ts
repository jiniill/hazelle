import { describe, expect, it, vi } from 'vitest';
import { appendUserMessage, startChat } from './chat-log';
import { duplicateChat } from './message-acts';
import type { Session } from '../session';
import { testServer } from '../testing';

const server = testServer();

describe('duplicateChat', () => {
  it("tells the chat's tools of a branch, with the ids the copies took", async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    await startChat(store, source, { title: null, character: null, models: {} }, null);
    const said = crypto.randomUUID();
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    const branched = vi.fn();
    const copied = await duplicateChat({ store, scriptCommands: { branched } as unknown as Session['scriptCommands'] }, source, '사본');
    if (!copied.ok) throw new Error(copied.error);
    expect(branched).toHaveBeenCalledWith(copied.data, { from: source, messages: { [said]: expect.any(String) }, versions: { [said]: expect.any(String) } });
  });
});
