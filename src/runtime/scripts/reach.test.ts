import { afterEach, expect, it, vi } from 'vitest';
import type { ChatScope } from '../../engine/render';
import { appendUserMessage, startChat } from '../chat/chat-log';
import type { Session } from '../session';
import { answerable, inTurn, saying, stubRelay, testServer } from '../testing';
import { ScriptReach } from './reach';

const server = testServer();
afterEach(() => vi.unstubAllGlobals());

// A 1×1 PNG's header, which is all the app reads of a picture before the browser draws it.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

async function asking(session: Session, sees: boolean) {
  await answerable(session);
  const [connection] = session.store.list('connection');
  await session.store.update('connection', connection!.id, (current) => ({ ...current, starred: current.starred.map((model) => ({ ...model, input: sees ? ['text', 'image'] : ['text'] })) }));
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
  const module = await session.store.create('module', { name: 'Looker', description: '', namespace: null, loreFolders: [], regex: [], triggers: [], toggles: [], botModels: true });
  if (!module.ok) throw new Error('fixture');
  const host = new ScriptReach(session, session.scriptInteractions, new AbortController().signal).host(chat, {} as ChatScope);
  return (messages: Hazelle.AskedMessage[]) => host.model('main', messages, { kind: 'module', id: module.data.id });
}

it("sends a plugin's pictures with its message to a model that reads them, and its cache point", () =>
  server.withSession(async (session) => {
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 1, height: 1, close: () => {} }));
    const ask = await asking(session, true);
    const log = stubRelay(inTurn([saying('a red coat')]));
    expect(await ask([{ role: 'system', content: 'Tag the outfit.', cache: true }, { role: 'user', content: 'This one.', pictures: [PNG] }])).toEqual({ success: true, result: 'a red coat' });
    expect(log[0]!.sent.body).toContain('data:image/png;base64,');
  }));

it('answers no-vision before anything is sent where the model reads no pictures, and failed for one the browser cannot draw', () =>
  server.withSession(async (session) => {
    const ask = await asking(session, false);
    const log = stubRelay(inTurn([]));
    expect(await ask([{ role: 'user', content: 'This one.', pictures: [PNG] }])).toMatchObject({ success: false, reason: 'no-vision' });
    const [connection] = session.store.list('connection');
    await session.store.update('connection', connection!.id, (current) => ({ ...current, starred: current.starred.map((model) => ({ ...model, input: ['text', 'image'] })) }));
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('undecodable')));
    expect(await ask([{ role: 'user', content: 'This one.', pictures: [PNG] }])).toMatchObject({ success: false, reason: 'failed' });
    expect(log).toHaveLength(0);
  }));
