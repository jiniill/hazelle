import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { readTool } from '../../engine/import/tool';
import { fold, shown } from '../../model/chat';
import { appendUserMessage, selectVersion, startChat } from '../chat/chat-log';
import { setDefaultModel } from '../models/assignment';
import { setModuleAlways } from '../library/modules';
import type { Session } from '../session';
import { answerable, saying, stubRelay, testServer } from '../testing';
import { inProcessTools } from '../testing/tool-transport';
import { takeTurn } from '../chat/turn';
import { wouldSend } from '../chat/turn-context';
import { ToolHost } from './host';
import { importTool, setToolSettings, toolData } from './store';

const server = testServer();
class Element extends EventTarget {
  textContent = '';
  value = '';
  readonly children: Element[] = [];
  constructor(readonly tag: string) { super(); }
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute() {}
}
const documentOf = () => ({ body: new Element('body'), createElement: (tag: string) => new Element(tag) });
async function imported(session: Session, name: string) {
  const result = readTool(new Uint8Array(await readFile(`e2e/fixtures/tools/${name}.js`)));
  if (!result.ok) throw new Error(result.failure.kind);
  const saved = await importTool(session.store, session.files, result.tool);
  if (!saved.ok) throw new Error(saved.error);
  await setModuleAlways(session.store, saved.data.id, true);
  return saved.data.id;
}
async function chatOf(session: Session) {
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  return chat;
}

it('runs the reference notepad page and background, saves through merged storage, and reopens the saved note', async () => {
  const pages: ReturnType<typeof documentOf>[] = [];
  const transport = inProcessTools((api, code) => {
    const document = documentOf();
    if (api.context === 'page') pages.push(document);
    runInNewContext(code, { hazelle: api, document }, { timeout: 1000 });
  });
  await server.withSession(async (session) => {
    const host = session.tools;
    const module = await imported(session, 'notepad');
    const chat = await chatOf(session);
    await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
    const open = () => host.page(module, { window: {} as Window, chat, theme: 'dark', close: () => {} });
    let close = open();
    try {
      await vi.waitFor(() => expect(pages[0]?.body.children).toHaveLength(4));
      const note = pages[0]!.body.children.find(({ tag }) => tag === 'textarea')!;
      note.value = 'A note kept in the vault';
      note.dispatchEvent(new Event('input'));
      await vi.waitFor(async () => expect(await toolData(session, module, 'note')).toEqual({ ok: true, data: note.value }), { timeout: 3000 });
      await vi.waitFor(() => expect(pages[0]!.body.children.at(-1)!.textContent).toBe('저장했어요'));
      await setToolSettings(session, module, { title: 'My notes' });
      await vi.waitFor(() => expect(pages[0]!.body.children[0]!.textContent).toBe('My notes'));
      close();
      close = open();
      await vi.waitFor(() => expect(pages[1]?.body.children.find(({ tag }) => tag === 'textarea')?.value).toBe('A note kept in the vault'));
      expect(transport.frames.filter(({ page }) => !page)).toHaveLength(1);
    } finally { close(); }
  }, (session, services) => new ToolHost(session, services, transport.open));
});

it('runs reference memory through the real script runtime, the aux connection, the tool slot, and version replay', async () => {
  const transport = inProcessTools((api, code) => { runInNewContext(code, { hazelle: api }, { timeout: 1000 }); });
  await server.withSession(async (session) => {
    await answerable(session);
    const connection = session.store.list('connection')[0]!.id;
    await setDefaultModel(session.store, 'aux', { connection, model: 'm' });
    const module = await imported(session, 'memory');
    const chat = await chatOf(session);
    let summaries = 0;
    const log = stubRelay(({ body }) => saying(body?.includes('Summarize the conversation') ? `summary ${++summaries}` : 'main reply'));
    await takeTurn(session, chat, { kind: 'send', text: 'The gate is open.' });
    await expect.poll(() => session.scriptInteractions.snapshot().questions).toMatchObject([{ from: { kind: 'module', id: module }, question: { kind: 'plugin' } }]);
    session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
    const messages = () => fold(session.store.children('entry', chat));
    const key = 'tool:hazelle/memory-lite:summary';
    await expect.poll(() => shown(messages()[1]!).after?.some(([name]) => name === key)).toBe(true);
    expect(summaries).toBe(1);
    await takeTurn(session, chat, { kind: 'send', text: 'We walk through.' });
    await expect.poll(() => summaries).toBe(2);
    await expect.poll(() => shown(messages()[3]!).after?.some(([name]) => name === key)).toBe(true);
    const original = shown(messages()[3]!).id;
    const sent = { prompt: session.log.entry(chat, shown(messages()[3]!).receipt!.id)!.prompt! };
    expect(sent.prompt.parts.some(({ from }) => from.kind === 'tool' && from.name === '간단 기억')).toBe(true);
    expect(sent.prompt.messages.some(({ content }) => content === 'summary 1')).toBe(true);
    expect(log.filter(({ sent }) => sent.body?.includes('Summarize the conversation'))).toHaveLength(2);
    const forecast = await wouldSend(session, chat, { kind: 'regenerate', message: messages()[3]!.id });
    // Forecasts intentionally use the last slot answer, not a new tool event.
    expect(forecast!.prompt.messages.some(({ content }) => content === 'summary 1')).toBe(true);
    await takeTurn(session, chat, { kind: 'regenerate', message: messages()[3]!.id });
    await expect.poll(() => summaries).toBe(3);
    await expect.poll(() => shown(messages()[3]!).after?.some(([name]) => name === key)).toBe(true);
    const replacement = { prompt: session.log.entry(chat, shown(messages()[3]!).receipt!.id)!.prompt! };
    expect(replacement.prompt.messages.some(({ content }) => content === 'summary 1')).toBe(true);
    expect(replacement.prompt.messages.some(({ content }) => content === 'summary 2')).toBe(false);
    await selectVersion(session.store, chat, messages()[3]!.id, original);
    expect(JSON.parse(shown(messages()[3]!).after!.find(([name]) => name === key)![1])).toBe('summary 2');
  }, (session, services) => new ToolHost(session, services, transport.open));
});
