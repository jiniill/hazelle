import { describe, expect, it } from 'vitest';
import { readTool } from '../engine/import/tool';
import { appendUserMessage, startChat } from './chat-log';
import { stateFacts } from './diagnostic-state';
import { setFact } from './memory';
import { setModuleAlways } from './modules';
import { answerable, testServer } from './testing';
import { importTool } from './tools/store';

const server = testServer();

describe('the state a 문제 진단 reports', () => {
  it('names a plugin and counts the chat, its memory and its request, with none of what was written', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const parsed = readTool(new TextEncoder().encode('//@api 1\n//@name keeper\n//@author jin\n//@version 1.2.3'));
      if (!parsed.ok) throw new Error('fixture');
      const added = await importTool(session.store, session.files, parsed.tool);
      if (!added.ok) throw new Error(added.error);
      await setModuleAlways(session.store, added.data.id, true);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: 'CANARY', character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'CANARY' });
      await setFact(session.store, chat, { about: 'CANARY', field: 'CANARY', value: 'CANARY', record: null }, null);

      const facts = await stateFacts(session, { kind: 'chat', id: chat });
      const report = JSON.stringify(facts);
      expect(report).not.toContain('CANARY');
      expect(report).not.toContain(chat);
      expect(facts).toMatchObject({
        place: 'chat',
        account: { chats: 1 },
        facts: {
          messages: 1,
          model: { id: 'm' },
          modules: { items: [{ tool: { name: 'keeper', version: '1.2.3' } }], more: 0 },
          memory: { facts: 1, records: 0 },
          request: { dropped: 0, memory: { missing: 0 } },
        },
      });
    }));
});
