import { runInNewContext } from 'node:vm';
import { noOutcome } from '../script-binding';
import { describe, expect, it, vi } from 'vitest';
import portingSample from '../../engine/import/fixtures/porting-sample.js.txt?raw';
import { readToolFile } from '../../engine/import/risu-plugin';
import { readTool } from '../../engine/import/tool';
import type { Host, ToolEvent, ToolReach } from '../../engine/script-api';
import { toolId } from '../../model/tool';
import type { Down, Up } from '../../tool-api/protocol';
import { shown } from '../../model/chat';
import { appendScripted, appendUserMessage, editMessage, startChat } from '../chat-log';
import { setModuleAlways, setModuleDeleted } from '../modules';
import { ToolLate, ToolStuck } from '../script-binding';
import type { Session } from '../session';
import { answerable, stubRelay, testServer } from '../testing';
import { RELAY_HEADER } from '../../contracts/http';
import { setModels, setNetwork } from '../pack';
import { blankCard } from '../../engine/import/card';
import { projectGreetings } from '../greetings';
import { upsertChatLore } from '../lore';
import { inProcessRisu, inProcessTools } from '../testing/tool-transport';
import { ToolHost } from './host';
import { UNLOAD_MS, type OpenFrame } from './frame';
import { importTool, setToolData, setToolSettings, toolData, toolDataId, TOOL_ROW_BYTES } from './store';

const server = testServer();
function withTools(test: (session: Session, connect: (open: OpenFrame) => ToolHost) => Promise<void>) {
  let open!: OpenFrame;
  return server.withSession((session) => test(session, (transport) => {
    open = transport;
    return session.tools as ToolHost;
  }), (session, services) => new ToolHost(session, services, (page) => open(page)));
}
const source = (version = '1', uses = '//@uses model\n') => {
  const result = readTool(new TextEncoder().encode(`//@api 1\n//@name test\n//@author jin\n//@version ${version}\n${uses}//@page Open\n//@menu now Now\n//@setting {"key":"title","type":"text","label":"Title","default":"A"}`));
  if (!result.ok) throw new Error('fixture');
  return result.tool;
};
async function fixture(session: Session, uses?: string, greeting?: string) {
  await answerable(session);
  const added = await importTool(session.store, session.files, source('1', uses));
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  const card = greeting === undefined ? null : await session.store.create('character', { card: { ...blankCard('Mira'), greetings: [greeting] }, folder: null, loreFolders: [] });
  if (card && !card.ok) throw new Error(card.error);
  await startChat(session.store, chat, { title: null, character: card?.data.id ?? null, models: {} }, card && projectGreetings([greeting!], [crypto.randomUUID()], 0));
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
  await session.store.projections.evaluate(chat);
  const tool = () => ({ module: added.data.id, tool: session.store.get('tool', toolId(added.data.id))!.value });
  const context = () => session.scriptPages.pageContext(chat, added.data.id)!;
  return { chat, module: added.data.id, tool, context };
}
const page = (chat: string | null = null) => ({ window: {} as Window, chat, theme: 'dark' as const, close: vi.fn() });

it('handshakes once, memoizes event reads, and sends only changed message tails', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => {
    api.on('prompt', async (chat) => {
      const messages = await chat.messages();
      await chat.state.get('summary');
      chat.state.set('summary', null);
      return messages.at(-1)!.text;
    });
  });
  const host = connect(transport.open);
  const reads = vi.spyOn(session.files, 'read');
  const states = vi.spyOn(session.store.evaluation, 'state');
  try {
    await host.warm(f.chat);
    const run = async () => { const context = f.context(); return host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host); };
    expect(await run()).toMatchObject({ value: 'hello', writes: [['tool:jin/test:summary', ' null']] });
    expect(states).toHaveBeenCalledTimes(1);
    expect(await run()).toMatchObject({ value: 'hello' });
    expect(transport.frames).toHaveLength(1);
    expect(reads).toHaveBeenCalledTimes(1);
    const answers = (transport.frames[0]!.host.sent as Down[]).filter((message) => message.kind === 'answer' && typeof message.value === 'object' && message.value !== null && 'items' in message.value);
    expect(answers.map((message) => (message as Extract<Down, { kind: 'answer' }>).value)).toEqual([{ from: 0, items: [expect.objectContaining({ text: 'hello' })] }, { from: 1, items: [] }]);
  } finally { host.close(); }
}));

it('names each message by its own id and the version shown', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const said = session.store.foldedChat(f.chat).messages[0]!;
  await editMessage(session.store, f.chat, said, 'edited', null);
  await session.store.projections.evaluate(f.chat);
  let read: Hazelle.Message[] = [];
  const transport = inProcessTools((api) => { api.on('prompt', async (chat) => { read = await chat.messages(); return null; }); });
  const host = connect(transport.open);
  try {
    const context = f.context();
    await host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    const edited = shown(session.store.foldedChat(f.chat).messages[0]!).id;
    expect(edited).not.toBe(said.id);
    expect(read).toEqual([expect.objectContaining({ index: 0, id: said.id, version: edited, text: 'edited' })]);
  } finally { host.close(); }
}));

it('answers an input item with the text it returns and refuses any other answer', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => api.on('input', (_chat, item, text) => item === 'tidy' ? `${text}!` : 3 as unknown as string));
  const host = connect(transport.open);
  try {
    const context = f.context();
    expect(await host.run(f.chat, f.tool(), context.scope, { kind: 'input', item: 'tidy', text: 'hi' }, context.host)).toMatchObject({ value: 'hi!' });
    await expect(host.run(f.chat, f.tool(), context.scope, { kind: 'input', item: 'count', text: 'hi' }, context.host)).rejects.toThrow('Invalid tool outcome');
  } finally { host.close(); }
}));

it('aborts the model call an input item is waiting on when the run is stopped', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => api.on('input', async (chat, _item, text) => { await chat.model('main', [{ role: 'user', content: text }]); return 'never'; }));
  const host = connect(transport.open);
  let call!: AbortSignal;
  const model = vi.fn((_role: unknown, _messages: unknown, _owner: unknown, signal?: AbortSignal) => { call = signal!; return new Promise<never>(() => {}); });
  try {
    const context = f.context();
    const stop = new AbortController();
    const running = host.run(f.chat, f.tool(), context.scope, { kind: 'input', item: 'tidy', text: 'hi' }, { ...context.host, model }, stop.signal);
    await vi.waitFor(() => expect(model).toHaveBeenCalled());
    stop.abort();
    await expect(running).rejects.toThrow();
    expect(call.aborted).toBe(true);
  } finally { host.close(); }
}));

it('runs a draft as no installed plugin, keeping its storage and settings writes in its own copy across its events, and names an error\'s line', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const code = [
    '//@api 1', '//@name draft', '//@author jin', '//@setting {"key":"title","type":"text","label":"Title","default":"A"}', '',
    'hazelle.on("prompt", async (chat) => { await hazelle.storage.set("seen", ((await hazelle.storage.get("seen")) ?? 0) + 1); await hazelle.setSetting("title", "B"); chat.state.set("n", 2); return `${await hazelle.storage.get("seen")}${(await hazelle.settings()).title}`; });',
    'hazelle.on("menu", () => { throw new Error("boom"); });',
  ].join('\n');
  const read = readTool(new TextEncoder().encode(code));
  if (!read.ok) throw new Error('fixture');
  const draft = { code, tool: { manifest: read.tool.manifest, settings: { title: 'A' } } };
  const transport = inProcessTools((api, text) => {
    Object.defineProperty(globalThis, 'hazelle', { value: api, configurable: true });
    // As sandbox/api.ts names a plugin's code, so a stack names its lines.
    return (0, eval)(`${text}\n//# sourceURL=hazelle-plugin.js`) as void;
  });
  const host = connect(transport.open);
  const stored = () => [session.store.list('tool').length, session.store.list('tooldata').length];
  const before = stored();
  try {
    const { scope, host: reach } = f.context();
    const trial = (...events: ToolEvent[]) => host.trial(f.chat, draft, new AbortController().signal, async (run) => {
      const ran = [];
      for (const event of events) ran.push(await run(scope, event, reach));
      return ran;
    });
    const prompt: ToolEvent = { kind: 'prompt', turn: { memory: false } };
    expect(await trial(prompt, prompt)).toMatchObject([
      { outcome: { value: '1B', writes: [[expect.stringMatching(/:n$/), expect.any(String)]] }, writes: [{ kind: 'storage', key: 'seen', value: 1 }, { kind: 'setting', key: 'title', value: 'B' }] },
      { outcome: { value: '2B' }, writes: [{ kind: 'storage', key: 'seen', value: 2 }, { kind: 'setting', key: 'title', value: 'B' }] },
    ]);
    await expect(trial({ kind: 'menu', item: 'now' })).rejects.toMatchObject({ message: 'boom', line: 7 });
    expect(await trial({ kind: 'input', item: 'tidy', text: '' })).toEqual([null]);
    expect(stored()).toEqual(before);
  } finally { host.close(); Reflect.deleteProperty(globalThis, 'hazelle'); }
}));

it('reads the greeting apart from the messages, which count from after it', () => withTools(async (session, connect) => {
  const f = await fixture(session, '', 'Welcome, {{user}}.');
  let read: { greeting: string | null; messages: Hazelle.Message[] } | null = null;
  const transport = inProcessTools((api) => { api.on('prompt', async (chat) => { read = { greeting: await chat.greeting(), messages: await chat.messages() }; return null; }); });
  const host = connect(transport.open);
  try {
    const context = f.context();
    await host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    expect(read).toEqual({ greeting: expect.stringMatching(/^Welcome, (?!\{\{)/), messages: [expect.objectContaining({ index: 0, text: 'hello' })] });
  } finally { host.close(); }
}));

it('refuses undeclared spending and forged event contexts, and isolates module storage', () => withTools(async (session, connect) => {
  const f = await fixture(session, '');
  let answer: Hazelle.ModelAnswer | null = null;
  let fetched: Hazelle.FetchAnswer | null = null;
  const transport = inProcessTools((api) => api.on('prompt', async (chat) => {
    answer = await chat.model('aux', [{ role: 'user', content: 'hi' }]);
    fetched = await chat.fetch('https://api.example.com/');
    return null;
  }));
  const host = connect(transport.open);
  try {
    const context = f.context();
    const model = vi.fn<Host['model']>();
    const fetch = vi.fn<ToolReach['fetch']>();
    await host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, { ...context.host, model, fetch });
    expect(answer).toEqual({ ok: false, reason: 'not-declared' });
    expect(fetched).toEqual({ ok: false, reason: 'not-declared' });
    expect(model).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const frame = transport.frames[0]!;
    frame.emit({ kind: 'call', call: 900, event: 9999, method: 'model', args: ['aux', []] });
    await vi.waitFor(() => expect(frame.host.sent).toContainEqual(expect.objectContaining({ kind: 'answer', call: 900, ok: false })));
    const other = await session.store.create('module', { name: 'other', description: '', namespace: null, loreFolders: [], regex: [], triggers: [], toggles: [] });
    if (!other.ok) throw new Error('fixture');
    await setToolData(session, other.data.id, 'secret', 'private');
    expect(await frame.api!.storage.get('secret')).toBeUndefined();
  } finally { host.close(); }
}));

it('asks once before a tool reaches the network, sends nothing when refused, and relays a consented fetch with its request and signal', () => withTools(async (session, connect) => {
  const f = await fixture(session, '//@uses network\n');
  const url = 'https://api.example.com/v1/chat';
  const log = stubRelay(() => new Response('{"error":"expired"}', { status: 401, headers: { [RELAY_HEADER]: 'upstream', 'content-type': 'application/json' } }));
  const relayed = globalThis.fetch;
  const signals: AbortSignal[] = [];
  let hold = false;
  vi.stubGlobal('fetch', (target: string, init: RequestInit) => {
    if (target !== '/api/relay') return relayed(target, init);
    signals.push(init.signal!);
    return hold ? new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) : relayed(target, init);
  });
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const close = host.page(f.module, page(f.chat));
  try {
    await vi.waitFor(() => expect(transport.frames[0]?.api?.page?.chat).toBeTruthy());
    const chat = transport.frames[0]!.api!.page!.chat!;
    const init = { method: 'POST', headers: { authorization: 'Bearer secret' }, body: '{"q":1}' } as const;
    const refused = chat.fetch(url, init);
    await vi.waitFor(() => expect(session.scriptInteractions.snapshot().questions).toEqual([expect.objectContaining({ question: { kind: 'plugin', grants: ['network'], hosts: [] } })]));
    session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'no');
    expect(await refused).toEqual({ ok: false, reason: 'not-allowed' });
    expect(log).toEqual([]);
    expect(session.store.get('module', f.module)!.value.network).toBe(false);

    await setNetwork(session.store, f.module, true);
    const answer = await chat.fetch(url, init);
    expect(log.map(({ sent }) => sent)).toEqual([{ url, method: 'POST', headers: { authorization: 'Bearer secret' }, body: '{"q":1}' }]);
    expect(answer).toMatchObject({ ok: true, status: 401 });
    if (!answer.ok) throw new Error('fixture');
    expect(new TextDecoder().decode(answer.body)).toBe('{"error":"expired"}');
    expect(answer.headers).toContainEqual(['content-type', 'application/json']);
    expect(answer.headers.map(([name]) => name)).not.toContain(RELAY_HEADER);

    hold = true;
    const abort = new AbortController();
    const held = chat.fetch(url, { signal: abort.signal });
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    abort.abort();
    await expect(held).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(signals[1]!.aborted).toBe(true));
    expect(host.hosts().get(f.module)).toEqual(new Map([['api.example.com', 1]]));
  } finally { close(); host.close(); }
}));

it('asks one card for all of a plugin\'s uses once the tool starts in a chat, keeps it past a send, and saves its one answer to each', () => withTools(async (session) => {
  const f = await fixture(session, '//@uses network\n//@uses model\n');
  session.scriptInteractions.claims(f.chat);
  session.scriptInteractions.claims(f.chat);
  await vi.waitFor(() => expect(session.scriptInteractions.snapshot().questions).toEqual([expect.objectContaining({ question: { kind: 'plugin', grants: ['network', 'model'], hosts: [] } })]));
  await session.scriptPages.pageWrite(f.chat, f.module, noOutcome());
  expect(session.scriptInteractions.snapshot().questions).toHaveLength(1);
  session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
  await vi.waitFor(() => expect(session.store.get('module', f.module)!.value).toMatchObject({ network: true, botModels: true }));
  session.scriptInteractions.claims(f.chat);
  expect(session.scriptInteractions.snapshot().questions).toEqual([]);
}));

it('moves a plugin card to the chat on screen that joins it, since a card shows only in its own chat, and not to a background one', () => withTools(async (session) => {
  const f = await fixture(session, '//@uses model\n');
  const other = crypto.randomUUID();
  await server.hold(session.store, other);
  await startChat(session.store, other, { title: null, character: null, models: {} }, null);
  session.scriptInteractions.claims(f.chat);
  await vi.waitFor(() => expect(session.scriptInteractions.snapshot().questions).toMatchObject([{ chat: f.chat }]));
  session.scriptInteractions.claims(other);
  expect(session.scriptInteractions.snapshot().questions).toMatchObject([{ chat: other, question: { kind: 'plugin', grants: ['model'] } }]);
  session.scriptPages.screen(f.chat, { send: async () => null, rendered: () => null });
  const sending = session.scriptPages.send(f.chat, '', { kind: 'module', id: f.module }, new AbortController().signal);
  expect(session.scriptInteractions.snapshot().questions).toMatchObject([{ chat: other }]);
  session.scriptInteractions.claims(f.chat);
  expect(session.scriptInteractions.snapshot().questions).toMatchObject([{ chat: f.chat }]);
  session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'no');
  await expect(sending).resolves.toEqual({ ok: false, reason: 'not-allowed' });
}));

it('tells that a consent answer could not be saved, and saves nothing for it', () => withTools(async (session) => {
  const f = await fixture(session, '//@uses model\n');
  session.scriptInteractions.claims(f.chat);
  await vi.waitFor(() => expect(session.scriptInteractions.snapshot().questions).toHaveLength(1));
  vi.spyOn(session.store, 'update').mockResolvedValueOnce({ ok: false, error: 'offline' });
  session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
  await vi.waitFor(() => expect(session.scriptInteractions.snapshot().notes).toContainEqual(expect.objectContaining({ kind: 'answer-unsaved', failure: { ok: false, error: 'offline' } })));
  expect(session.store.get('module', f.module)!.value.botModels).toBeUndefined();
}));

it('keeps a plugin card past the asker that stopped waiting, and sends nothing for it once answered', () => withTools(async (session) => {
  const f = await fixture(session, '//@uses model\n');
  const sent: string[] = [];
  session.scriptPages.screen(f.chat, { send: async (text) => { sent.push(text); return null; }, rendered: () => null });
  const stop = new AbortController();
  const sending = session.scriptPages.send(f.chat, '', { kind: 'module', id: f.module }, stop.signal);
  await vi.waitFor(() => expect(session.scriptInteractions.snapshot().questions).toHaveLength(1));
  stop.abort();
  await expect(sending).resolves.toEqual({ ok: false, reason: 'not-allowed' });
  expect(session.scriptInteractions.snapshot().questions).toHaveLength(1);
  session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
  await vi.waitFor(() => expect(session.store.get('module', f.module)!.value.botModels).toBe(true));
  expect(sent).toEqual([]);
}));

it('lets no use borrow the answer of a card that never named it, as one asked before a re-import added the use', () => withTools(async (session) => {
  const f = await fixture(session, '//@uses memory\n');
  session.scriptInteractions.claims(f.chat);
  await vi.waitFor(() => expect(session.scriptInteractions.snapshot().questions).toMatchObject([{ question: { kind: 'plugin', grants: ['memory'] } }]));
  await session.store.update('tool', toolId(f.module), (tool) => ({ ...tool, manifest: { ...tool.manifest, uses: [...tool.manifest.uses, 'model'] } }));
  session.scriptPages.screen(f.chat, { send: async () => null, rendered: () => null });
  const sending = session.scriptPages.send(f.chat, '', { kind: 'module', id: f.module }, new AbortController().signal);
  session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
  await expect(sending).resolves.toEqual({ ok: false, reason: 'not-allowed' });
  expect(session.store.get('module', f.module)!.value).toMatchObject({ takesMemory: true });
  expect(session.store.get('module', f.module)!.value.botModels).toBeUndefined();
}));

it('keeps a switch answered while its plugin card waited', () => withTools(async (session) => {
  const f = await fixture(session, '//@uses network\n//@uses model\n');
  session.scriptInteractions.claims(f.chat);
  await vi.waitFor(() => expect(session.scriptInteractions.snapshot().questions).toHaveLength(1));
  await setModels(session.store, { kind: 'module', id: f.module }, false);
  session.scriptInteractions.answer(session.scriptInteractions.snapshot().questions[0]!.id, 'yes');
  await vi.waitFor(() => expect(session.store.get('module', f.module)!.value).toMatchObject({ network: true, botModels: false }));
}));

it('opens a Risu frame with the sandbox network variant only under its module consent, and restarts it when given or withdrawn', () => withTools(async (session, connect) => {
  await answerable(session);
  const parsed = source('1', '//@uses network\n');
  const added = await importTool(session.store, session.files, { ...parsed, manifest: { ...parsed.manifest, page: null, menu: [], risu: { verdict: 'all', missing: [], hosts: [] } } });
  if (!added.ok) throw new Error(added.error);
  const module = added.data.id;
  await setModuleAlways(session.store, module, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const transport = inProcessRisu(() => {});
  const host = connect(transport.open);
  try {
    await setNetwork(session.store, module, true);
    await host.warm(chat);
    expect(transport.frames.map((frame) => frame.opening)).toEqual([{ role: 'frame', network: true }]);
    await setNetwork(session.store, module, false);
    await vi.waitFor(() => expect(transport.frames[0]!.host.closed).toBe(true), { timeout: UNLOAD_MS * 2 });
    await host.warm(chat);
    expect(transport.frames[1]!.opening).toEqual({ role: 'frame', network: false });
    await setNetwork(session.store, module, true);
    await vi.waitFor(() => expect(transport.frames.map((frame) => frame.opening)).toEqual([{ role: 'frame', network: true }, { role: 'frame', network: false }, { role: 'frame', network: true }]), { timeout: UNLOAD_MS * 2 });
    await vi.waitFor(() => expect(transport.frames[1]!.host.closed).toBe(true), { timeout: UNLOAD_MS * 2 });
  } finally { host.close(); }
}));

it('times out a prompt without applying its late outcome, while model waits still answer pings', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  let finish!: (value: Hazelle.ModelAnswer) => void;
  const transport = inProcessTools((api) => api.on('prompt', async (chat) => {
    await chat.model('aux', []);
    chat.state.set('late', true);
    return 'late';
  }));
  const host = connect(transport.open);
  const context = f.context();
  const model = vi.fn<Host['model']>(() => new Promise((resolve) => { finish = (value) => resolve(value.ok ? { success: true, result: value.text } : { success: false, result: '', reason: value.reason }); }));
  try {
    await host.warm(f.chat);
    vi.useFakeTimers();
    const abort = new AbortController();
    const running = host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, { ...context.host, model }, abort.signal);
    const refused = expect(running).rejects.toBeInstanceOf(ToolLate);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport.frames[0]!.host.closed).toBe(false);
    abort.abort(new ToolLate());
    await refused;
    finish({ ok: true, text: 'done' });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toEqual([]);
  } finally { vi.useRealTimers(); host.close(); }
}));

it('resets stalls after loading, then disables three consecutive stalled loads and tells once', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => api.on('prompt', () => 'ready'));
  let silent = true;
  const host = connect((page) => {
    const connection = transport.open(page);
    transport.frames.at(-1)!.sandbox.silent = silent;
    return connection;
  });
  vi.spyOn(session.files, 'read').mockResolvedValue({ ok: true, data: source().bytes });
  const stall = async () => {
    const context = f.context();
    const running = host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    const refused = expect(running).rejects.toBeInstanceOf(ToolStuck);
    await vi.advanceTimersByTimeAsync(8001);
    await refused;
    expect(transport.frames.at(-1)!.host.closed).toBe(true);
  };
  try {
    vi.useFakeTimers();
    await stall();
    await stall();
    silent = false;
    await host.warm(f.chat);
    transport.frames.at(-1)!.sandbox.silent = true;
    await vi.advanceTimersByTimeAsync(10_001);
    expect(transport.frames.at(-1)!.host.closed).toBe(true);
    silent = true;
    await stall();
    await stall();
    await host.warm(f.chat);
    await host.warm(f.chat);
    expect(session.scriptInteractions.snapshot().notes.filter((note) => note.kind === 'stuck' && note.disabled)).toHaveLength(1);
    expect(transport.frames).toHaveLength(5);
    expect(host.hears(f.module, 'showing')).toBe(false);
    const context = f.context();
    await expect(host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host)).rejects.toMatchObject({ disabled: true });
  } finally { vi.useRealTimers(); host.close(); }
}));

it('waits for slow code and page chat reads before starting the load watchdog, and passes a missing persona as null', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  let read!: () => void;
  vi.spyOn(session.files, 'read').mockImplementation(() => new Promise((resolve) => { read = () => resolve({ ok: true, data: source().bytes }); }));
  const retain = session.store.retainChat.bind(session.store);
  let loaded!: () => void;
  vi.spyOn(session.store, 'retainChat').mockImplementation((chat) => {
    const lease = retain(chat);
    return { ...lease, ready: lease.ready.then(() => new Promise<null>((resolve) => { loaded = () => resolve(null); })) };
  });
  const context = f.context();
  vi.spyOn(session.scriptPages, 'pageContext').mockReturnValue({ ...context, scope: { ...context.scope, persona: null } });
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  try {
    vi.useFakeTimers();
    host.page(f.module, page(f.chat));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.frames[0]!.host.closed).toBe(false);
    read();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.frames[0]!.host.sent).not.toContainEqual(expect.objectContaining({ kind: 'load' }));
    loaded();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.frames[0]!.api!.page!.chat!.persona).toBeNull();
    expect(session.scriptInteractions.snapshot().notes).toEqual([]);
  } finally { vi.useRealTimers(); host.close(); }
}));

describe('tool storage transport', () => {
  it('merges writes by key, fans out changes from both frames and other devices, and sends new settings', () => withTools(async (session, connect) => {
    const f = await fixture(session);
    const changes: string[][] = [];
    const settings: Hazelle.Settings[] = [];
    const transport = inProcessTools((api) => {
      api.storage.onChange((keys) => changes.push(keys));
      if (api.context === 'background') api.on('settings', (values) => { settings.push(values); });
    });
    const host = connect(transport.open);
    const close = host.page(f.module, page());
    try {
      await host.warm(f.chat);
      await vi.waitFor(() => expect(transport.frames.every((frame) => frame.api !== null)).toBe(true));
      const [a, b] = transport.frames.map((frame) => frame.api!);
      const writes = vi.spyOn(session.store, 'batch');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const first = a!.storage.set('note', 'first');
      const last = b!.storage.set('note', 'last');
      await vi.advanceTimersByTimeAsync(1001);
      vi.useRealTimers();
      await Promise.all([first, last]);
      expect(await toolData(session, f.module, 'note')).toEqual({ ok: true, data: 'last' });
      expect(writes.mock.calls.filter(([batch]) => batch.some((write) => 'kind' in write && write.kind === 'tooldata'))).toHaveLength(1);
      await vi.waitFor(() => expect(changes).toHaveLength(2));
      expect(changes).toEqual([['note'], ['note']]);
      const object = await toolDataId(f.module, 'note');
      await session.store.update('tooldata', object, () => ({ key: 'note', value: 'another device' }));
      await vi.waitFor(() => expect(changes).toHaveLength(4));
      expect(await a!.storage.get('note')).toBe('another device');
      await setToolSettings(session, f.module, { title: 'B' });
      await vi.waitFor(() => expect(settings).toEqual([{ title: 'B' }]));
    } finally { vi.useRealTimers(); close(); host.close(); }
  }));

  it('permits at most thirty store writes per minute per tool', () => withTools(async (session, connect) => {
    const f = await fixture(session);
    const transport = inProcessTools(() => {});
    const host = connect(transport.open);
    try {
      await host.warm(f.chat);
      const api = transport.frames[0]!.api!;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const writes = Array.from({ length: 31 }, (_, index) => api.storage.set(String(index), index));
      const settled = Promise.allSettled(writes);
      await vi.advanceTimersByTimeAsync(1001);
      vi.useRealTimers();
      const results = await settled;
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(30);
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(session.store.children('tooldata', f.module)).toHaveLength(30);
    } finally { vi.useRealTimers(); host.close(); }
  }));
});

it('restarts changed code, closes on deletion, idles without a page, and retains the file cache', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const read = vi.spyOn(session.files, 'read');
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await host.warm(f.chat);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(transport.frames[0]!.host.closed).toBe(true);
    vi.useRealTimers();
    await host.warm(f.chat);
    expect(read).toHaveBeenCalledTimes(1);
    await importTool(session.store, session.files, source('2'));
    await vi.waitFor(() => expect(transport.frames[1]!.host.closed).toBe(true));
    await host.warm(f.chat);
    expect(read).toHaveBeenCalledTimes(2);
    await setModuleDeleted(session.store, f.module, Date.now());
    await vi.waitFor(() => expect(transport.frames[2]!.host.closed).toBe(true));
    expect(host.menus(f.chat)).toEqual([]);
  } finally { vi.useRealTimers(); host.close(); }
}));

it('ignores malformed outcomes and all messages from a frame after it has closed', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  let release!: () => void;
  const transport = inProcessTools((api) => api.on('prompt', () => new Promise<string>((resolve) => { release = () => resolve('late'); })));
  const host = connect(transport.open);
  try {
    const context = f.context();
    const running = host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    const refused = expect(running).rejects.toThrow('Invalid tool outcome');
    await vi.waitFor(() => expect(release).toBeDefined());
    const frame = transport.frames[0]!;
    const event = (frame.host.sent as Down[]).find((message) => message.kind === 'event')!;
    frame.emit({ kind: 'done', id: event.id, outcome: { writes: [['key', NaN]], edits: [], added: [] } } as unknown as Up);
    await refused;
    const receive = frame.host.onmessage!;
    host.close();
    receive(new MessageEvent('message', { data: { kind: 'call', call: 90, method: 'storage.set', args: ['after-close', true] } }));
    await Promise.resolve();
    expect(await toolData(session, f.module, 'after-close')).toEqual({ ok: true, data: undefined });
  } finally { release?.(); host.close(); }
}));

it('notifies a running tool after pulling a data change written on another device', async () => {
  const account = await server.account();
  const added = await importTool(account.store, account.files, source());
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(account.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(account.store, chat);
  await startChat(account.store, chat, { title: null, character: null, models: {} }, null);
  const changes = vi.fn();
  const transport = inProcessTools((api) => { api.storage.onChange(changes); });
  const host = new ToolHost(account, { journal: { report: () => {} }, pages: { pageContext: () => null, pageWrite: async () => {}, send: async () => ({ ok: true as const }), rendered: () => null } }, transport.open);
  try {
    await host.warm(chat);
    const peer = await account.open();
    await peer.pull();
    expect((await setToolData({ store: peer, files: account.files }, added.data.id, 'remote', { note: 'from another device' })).ok).toBe(true);
    expect(await account.store.pull()).toBeNull();
    await vi.waitFor(() => expect(changes).toHaveBeenCalledWith(['remote']));
    expect(await transport.frames[0]!.api!.storage.get('remote')).toEqual({ note: 'from another device' });
    const big = 'r'.repeat(TOOL_ROW_BYTES);
    expect((await setToolData({ store: peer, files: account.files }, added.data.id, 'remote', big)).ok).toBe(true);
    expect(await account.store.pull()).toBeNull();
    await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(2));
    expect(changes).toHaveBeenLastCalledWith(['remote']);
    expect(await transport.frames[0]!.api!.storage.get('remote')).toBe(big);
  } finally { host.close(); }
});

it('applies page chat writes through the page runtime, distinguishes null and deletion, and keeps the page alive while open', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const descriptor = page(f.chat);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const close = host.page(f.module, descriptor);
  try {
    await vi.waitFor(() => expect(transport.frames[0]!.api).not.toBeNull());
    const chat = transport.frames[0]!.api!.page!.chat!;
    chat.state.set('nullable', null);
    expect(await chat.state.get('nullable')).toBeNull();
    await vi.waitFor(() => expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toMatchObject([{ value: { stays: true, set: [['tool:jin/test:nullable', ' null']] } }]));
    chat.state.delete('nullable');
    expect(await chat.state.get('nullable')).toBeUndefined();
    await vi.waitFor(() => expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toHaveLength(2));
    expect(await chat.state.get('nullable')).toBeUndefined();
    await host.warm(f.chat);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(transport.frames[0]!.host.closed).toBe(false);
    vi.useRealTimers();
    expect(descriptor.close).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); close(); host.close(); }
}));

it('writes the chat\'s own lorebook by name and its variables unprefixed, sends through the open chat screen once models are allowed, and reads a message as it draws it', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const close = host.page(f.module, page(f.chat));
  const screen = vi.fn<(text: string) => Promise<'busy' | 'failed' | null>>(async () => null);
  try {
    await vi.waitFor(() => expect(transport.frames[0]!.api).not.toBeNull());
    const chat = transport.frames[0]!.api!.page!.chat!;
    expect(await chat.send('go')).toEqual({ ok: false, reason: 'closed' });
    const [hello] = await chat.messages();
    expect(await chat.rendered(hello!)).toBeNull();
    const drawn = { html: '<p>hello</p>', css: '', text: 'hello' };
    const greeting = { html: '<p>welcome</p>', css: '', text: 'welcome' };
    const leave = session.scriptPages.screen(f.chat, { send: screen, rendered: (at) => (at === null ? greeting : at.id === hello!.id && at.version === hello!.version ? drawn : null) });
    expect(await chat.rendered(hello!)).toEqual(drawn);
    expect(await chat.rendered(null)).toEqual(greeting);
    await setModels(session.store, { kind: 'module', id: f.module }, true);
    chat.writeLore({ name: 'save', keys: ['hero'], text: '{}', always: false, on: true });
    chat.variables.set('sh_Player', 'Jin');
    expect(() => chat.variables.set('tool:other/x:k', '1')).toThrow();
    expect(await chat.send('')).toEqual({ ok: true });
    expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toMatchObject([{ value: { set: [['sh_Player', 'Jin']] } }]);
    expect(await chat.variables.get('sh_Player')).toBe('Jin');
    expect(screen).toHaveBeenCalledWith('');
    expect(session.store.children('lore', f.chat).map(({ value }) => value)).toMatchObject([{ name: 'save', keys: ['hero'], content: '{}', constant: false, enabled: true }]);
    screen.mockResolvedValueOnce('busy');
    expect(await chat.send('go')).toEqual({ ok: false, reason: 'busy' });
    leave();
  } finally { close(); host.close(); }
}));

it('allows a standalone page storage but refuses chat calls with no chat capability', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const close = host.page(f.module, page());
  try {
    await vi.waitFor(() => expect(transport.frames[0]!.api).not.toBeNull());
    const frame = transport.frames[0]!;
    expect(frame.api!.page!.chat).toBeNull();
    frame.emit({ kind: 'call', call: 77, method: 'model', args: ['aux', []] });
    await vi.waitFor(() => expect(frame.host.sent).toContainEqual({ kind: 'answer', call: 77, ok: false, value: 'no-chat' }));
    expect(session.scriptInteractions.snapshot().questions).toEqual([]);
  } finally { close(); host.close(); }
}));

it('shares the write budget with forged page outcomes and bounds tool notices across ids', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const apply = vi.spyOn(session.scriptPages, 'pageWrite').mockResolvedValue();
  const close = host.page(f.module, page(f.chat));
  try {
    await vi.waitFor(() => expect(transport.frames[0]!.api).not.toBeNull());
    const frame = transport.frames[0]!;
    await expect(frame.api!.storage.set('x'.repeat(257), null)).rejects.toThrow('key-too-long');
    for (let i = 0; i < 1000; i++) frame.emit({ kind: 'done', id: 0, outcome: { writes: [], edits: [], added: [{ role: 'char', text: 'flood' }], data: [], badges: [], lore: [], variables: [] } });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(30));
    expect(frame.host.sent).toContainEqual(expect.objectContaining({ kind: 'answer', call: 0, ok: false, value: 'too-many-writes' }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const write = expect(frame.api!.storage.set('over-budget', true)).rejects.toThrow('too-many-writes');
    await vi.advanceTimersByTimeAsync(1001);
    await write;
    vi.useRealTimers();
    for (let i = 0; i < 10; i++) frame.emit({ kind: 'failed', id: 0, message: 'same failure' });
    for (let i = 0; i < 10; i++) frame.emit({ kind: 'call', call: 100 + i, method: 'say', args: ['normal', `notice ${i}`] });
    await vi.waitFor(() => expect(session.scriptInteractions.snapshot().notes).toHaveLength(3));
    expect(session.scriptInteractions.snapshot().notes.filter((note) => note.kind === 'failed')).toHaveLength(1);
  } finally { vi.useRealTimers(); close(); host.close(); }
}));

it('runs a new chat\'s frame tool from its draft before the first save, and lets go of a draft once it is left', () => withTools(async (session, connect) => {
  await answerable(session);
  const parsed = source('1', '');
  const added = await importTool(session.store, session.files, { ...parsed, manifest: { ...parsed.manifest, page: null, menu: [], risu: { verdict: 'all', missing: [], hosts: [] } } });
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  const module = added.data.id;
  const chat = crypto.randomUUID();
  const draft = { title: null, character: null, models: {} };
  const pressed = vi.fn();
  const transport = inProcessRisu((scope) => {
    const risu = scope.Risuai as Record<string, (...args: unknown[]) => Promise<unknown>>;
    void risu.registerButton!({ name: 'Cast', id: 'cast' }, async () => pressed(await risu.getCurrentChatIndex!()));
  });
  const host = connect(transport.open);
  try {
    expect(host.menusOf(draft).map((menu) => menu.module)).toEqual([module]);
    const leave = host.draft(chat, draft);
    await vi.waitFor(() => expect(host.items(module)).toEqual([{ id: 'cast', label: 'Cast' }]));
    await setToolData(session, module, 'touch', 1);
    expect(host.frames().get(module)?.chat).toBe(chat);
    await server.hold(session.store, chat);
    await startChat(session.store, chat, draft, null);
    await session.scriptCommands.menu(chat, module, 'cast');
    await vi.waitFor(() => expect(pressed).toHaveBeenCalledWith(expect.any(Number)));
    expect(pressed).not.toHaveBeenCalledWith(-1);
    leave();
    await Promise.resolve();
    expect(host.frames().get(module)?.chat).toBe(chat);
    host.draft(crypto.randomUUID(), draft)();
    await vi.waitFor(() => expect(host.frames().get(module)?.chat).toBeNull());
  } finally { host.close(); }
}));

it('runs a frame tool as one frame: its registered items, a press from the chat, a remounted slot, its page and the chat it reads', () => withTools(async (session, connect) => {
  await answerable(session);
  const parsed = source('1', '');
  const added = await importTool(session.store, session.files, { ...parsed, manifest: { ...parsed.manifest, page: null, menu: [], risu: { verdict: 'all', missing: [], hosts: [] } } });
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const module = added.data.id;
  const pressed = vi.fn();
  const opens = vi.fn();
  const transport = inProcessRisu((scope) => {
    const risu = scope.Risuai as Record<string, (...args: unknown[]) => Promise<unknown>>;
    void risu.registerButton!({ name: 'Cast', id: 'cast' }, async () => { pressed(await risu.getCurrentChatIndex!()); await risu.showContainer!('fullscreen'); });
    void risu.registerSetting!('Open', () => { opens(); return risu.showContainer!('fullscreen'); });
  });
  const host = connect(transport.open);
  try {
    await host.warm(chat);
    const { items } = host;
    await vi.waitFor(() => expect(items(module)).toEqual([{ id: 'cast', label: 'Cast' }]));
    expect(transport.frames.map((frame) => frame.api?.context)).toEqual(['frame']);
    await session.scriptCommands.menu(chat, module, 'cast');
    await vi.waitFor(() => expect(host.frames().get(module)).toEqual({ menu: [{ id: 'cast', label: 'Cast' }], actions: [], chat, asking: true }));
    expect(pressed.mock.calls[0]![0]).toEqual(expect.any(Number));
    expect(pressed.mock.calls[0]![0]).not.toBe(-1);
    const shownIn = { chat, place: vi.fn(), close: vi.fn() };
    const detach = host.attach(module, shownIn);
    await vi.waitFor(() => expect(shownIn.place).toHaveBeenCalledTimes(1));
    expect(host.frames().get(module)?.asking).toBe(false);
    detach();
    const remounted = { chat, place: vi.fn(), close: vi.fn() };
    const detachRemounted = host.attach(module, remounted);
    await vi.waitFor(() => expect(remounted.place).toHaveBeenCalledTimes(1));
    expect(opens).not.toHaveBeenCalled();
    detachRemounted();
    await vi.waitFor(() => expect(host.frames().get(module)?.asking).toBe(false));
    const opened = { chat: null, place: vi.fn(), close: vi.fn() };
    host.attach(module, opened);
    await vi.waitFor(() => expect(opened.place).toHaveBeenCalledTimes(1));
    expect(opens).toHaveBeenCalledTimes(1);
    expect(transport.frames).toHaveLength(1);
  } finally { host.close(); }
}));

it('writes a tool\'s own settings field and refuses a value the field cannot hold', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  try {
    await host.warm(f.chat);
    const api = transport.frames[0]!.api!;
    await api.setSetting('title', 'B');
    expect(session.store.get('tool', toolId(f.module))!.value.settings).toEqual({ title: 'B' });
    await expect(api.setSetting('title', 3)).rejects.toThrow('Invalid tool call');
    await expect(api.setSetting('missing', 'x')).rejects.toThrow('Invalid tool call');
  } finally { host.close(); }
}));

it('reads the chat\'s lorebook by owner, how the chat is set up, and the account\'s personas and characters', () => withTools(async (session, connect) => {
  const f = await fixture(session, undefined, 'Hello.');
  const character = session.store.get('chat', f.chat)!.value.character!;
  await upsertChatLore(session.store, f.chat, { name: 'Gate', keys: ['gate'], secondaryKeys: [], content: 'The gate is shut.', enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 0, priority: null, position: null });
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const close = host.page(f.module, page(f.chat));
  try {
    await vi.waitFor(() => expect(transport.frames[0]?.api).not.toBeNull());
    const api = transport.frames[0]!.api!;
    expect(await api.page!.chat!.lorebook()).toEqual([{ name: 'Gate', keys: ['gate'], text: 'The gate is shut.', always: false, on: true, owner: { kind: 'chat', id: f.chat } }]);
    const account = await api.account();
    expect(account.characters).toEqual([{ id: character, name: 'Mira' }]);
    const setup = await api.page!.chat!.setup();
    expect(setup).toEqual({ persona: account.personas.find(({ current }) => current)?.id ?? null, limits: { context: null, reply: null }, modules: [{ id: f.module, name: 'test' }] });
  } finally { close(); host.close(); }
}));

it('answers a frame tool\'s unload callbacks while its port stays open, then closes it', () => withTools(async (session, connect) => {
  await answerable(session);
  const parsed = source('1', '');
  const added = await importTool(session.store, session.files, { ...parsed, manifest: { ...parsed.manifest, page: null, menu: [], risu: { verdict: 'all', missing: [], hosts: [] } } });
  if (!added.ok) throw new Error(added.error);
  const module = added.data.id;
  await setModuleAlways(session.store, module, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const transport = inProcessRisu((scope) => {
    const risu = scope.Risuai as { onUnload(callback: () => unknown): Promise<void>; pluginStorage: { setItem(key: string, value: string): Promise<void> } };
    void risu.onUnload(() => risu.pluginStorage.setItem('last', 'saved'));
  });
  const host = connect(transport.open);
  try {
    await host.warm(chat);
    await vi.waitFor(() => expect(host.hears(module, 'menu')).toBe(true));
    await setModuleAlways(session.store, module, false);
    await vi.waitFor(async () => expect(await toolData(session, module, 'plugin:last')).toEqual({ ok: true, data: 'saved' }), { timeout: 3000 });
    await vi.waitFor(() => expect(transport.frames[0]!.host.closed).toBe(true));
  } finally { host.close(); }
}));

it('learns of a listener a tool adds after it has loaded', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  let later!: () => void;
  const transport = inProcessTools((api) => { later = () => api.on('showing', () => {}); });
  const host = connect(transport.open);
  try {
    expect(host.hears(f.module, 'showing')).toBeNull();
    await host.warm(f.chat);
    expect(host.hears(f.module, 'showing')).toBe(false);
    later();
    await vi.waitFor(() => expect(host.hears(f.module, 'showing')).toBe(true));
  } finally { host.close(); }
}));

// A 1×1 PNG, what the sample's OffscreenCanvas stands in for here; only a browser run draws one.
const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
class Canvas {
  getContext() { return { fillStyle: '', fillRect: () => {} }; }
  async convertToBlob() { return new Blob([Uint8Array.from(atob(PICTURE), (char) => char.charCodeAt(0))], { type: 'image/png' }); }
}

it('runs the porting sample as imported: each reply gets its picture as a 삽화, and its message action redraws it, after a fresh frame too', () => withTools(async (session, connect) => {
  await answerable(session);
  const read = readToolFile(new TextEncoder().encode(portingSample));
  if (!read.ok) throw new Error('fixture');
  expect(read.tool.manifest).toMatchObject({ uses: [], risu: { verdict: 'all', missing: [], hosts: [] } });
  const added = await importTool(session.store, session.files, read.tool);
  if (!added.ok) throw new Error(added.error);
  const module = added.data.id;
  await setModuleAlways(session.store, module, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
  await appendScripted(session.store, chat, { edits: [], removed: [], added: [{ follows: null, ahead: null, messages: [{ role: 'assistant', text: 'The tide turns.\nGulls rise.' }] }], vars: null });
  await session.store.projections.evaluate(chat);
  const reply = session.store.foldedChat(chat).messages[1]!.id;
  let slots!: { attachPicture(chatId: string, bytes: Uint8Array): Promise<void>; registerMessageAction(item: { id: string; label: string }, callback: () => void): Promise<void> };
  const transport = inProcessRisu((scope, code) => {
    Object.assign(scope, { OffscreenCanvas: Canvas, console });
    slots = scope.PluginSlots as typeof slots;
    runInNewContext(code, scope);
  });
  const host = connect(transport.open);
  const pictures = () => session.store.children('illustration', chat);
  try {
    await host.warm(chat);
    await vi.waitFor(() => expect(host.actions(module)).toEqual([{ id: 'redraw', label: '다시 그리기' }]));
    const context = session.scriptPages.pageContext(chat, module)!;
    // The reply event ends before the picture is drawn; the picture lands after it, as a slow one would.
    await host.run(chat, { module, tool: session.store.get('tool', toolId(module))!.value }, context.scope, { kind: 'reply', reply: { index: 1, id: reply, version: reply } }, context.host);
    await vi.waitFor(() => expect(pictures()).toHaveLength(1));
    const first = pictures()[0]!;
    expect(first.value).toEqual({ message: reply, version: reply, file: expect.any(Object), type: 'image/png', size: atob(PICTURE).length, at: expect.any(Number), paragraph: 1, line: expect.any(String), width: 1, height: 1, tool: { module, name: '포팅 예제' }, caption: '응답에 맞춘 색' });

    await setModuleAlways(session.store, module, false);
    await vi.waitFor(() => expect(transport.frames[0]!.host.closed).toBe(true), { timeout: 3000 });
    await setModuleAlways(session.store, module, true);
    await host.warm(chat);
    await vi.waitFor(() => expect(host.actions(module)).toEqual([{ id: 'redraw', label: '다시 그리기' }]));
    expect(transport.frames).toHaveLength(2);
    expect(pictures().map(({ id }) => id)).toEqual([first.id]);
    await session.scriptCommands.action(chat, module, 'redraw', reply);
    await vi.waitFor(() => expect(pictures()[0]!.rev).toBeGreaterThan(first.rev));
    expect(pictures().map(({ id }) => id)).toEqual([first.id]);
    // Past the header's cap of three, or on a message no chat read holds, the call fails where the plugin can see it.
    for (const id of ['a', 'b']) await slots.registerMessageAction({ id, label: id }, () => {});
    await expect(slots.registerMessageAction({ id: 'c', label: 'c' }, () => {})).rejects.toThrow('At most 3');
    expect(host.actions(module).map(({ id }) => id)).toEqual(['redraw', 'a', 'b']);
    await expect(slots.attachPicture(crypto.randomUUID(), new Uint8Array())).rejects.toThrow('no chat read here has message');
    // The user moved to another chat while it was drawn: the picture still lands on the message it was drawn for.
    const other = crypto.randomUUID();
    await server.hold(session.store, other);
    await startChat(session.store, other, { title: null, character: null, models: {} }, null);
    await host.warm(other);
    const before = pictures()[0]!.rev;
    await slots.attachPicture(reply, Uint8Array.from(atob(PICTURE), (char) => char.charCodeAt(0)));
    expect(pictures()[0]!.rev).toBeGreaterThan(before);
    expect(session.store.children('illustration', other)).toEqual([]);
  } finally { host.close(); }
}));
