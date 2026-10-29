import type { ToolEvent } from '../engine/script-api';
import { serverBackend } from './backend';
import type { createTools } from './tools/host';
import type { Binding } from './script-binding';
import { toolId, type ToolUnit } from '../model/tool';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { RELAY_HEADER } from '../contracts/http';
import { bareModel } from '../connectors/chat-completions';
import type { Connection, HttpRequest, Model } from '../connectors/types';
import { Lua } from '../engine/lua/run';
import type { Upstream } from '../server/relay';
import { sessionCookie, signupBody, testApp } from '../server/testing';
export { sessionCookie, signupBody, testApp } from '../server/testing';
import { randomBytes } from '../vault/aead';
import type { VaultKey } from '../vault/keys';
import { api, holdAccount } from './api';
import { setDefaultModel } from './assignment';
import { runEvent } from './lua/event';
import { Files } from './files';
import { RequestLog, type Logged } from './request-log';
import { openSession, type Session } from './session';
import { ObjectStore } from './store';

// The bot scripts run in the test's own thread: node has no Worker to load them into. Made before withSession stubs
// window, which the VM's loader would read as a browser.
const lua = Lua.create();

type App = Awaited<ReturnType<typeof testApp>>;
// The relay's answer to the upstream request it carries. null is a connection that dropped.
type Relay = (sent: HttpRequest) => Response | null;

let server: { app: App; cookie: string | null } | null = null;
let relay: Relay | null = null;
// The server's answers not given yet, which a test waits for before its server goes: a call's marker and its drop
// are written after the result, while the test may already be done.
const answered = new Set<Promise<Response>>();

// Use the real in-process SQLite/file server for API routes; stub only provider relay answers.
function stubFetch() {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (url === '/api/relay') {
      if (!relay) throw new Error('This test gave the relay no answers.');
      const answer = relay(JSON.parse(init.body as string) as HttpRequest);
      if (!answer) throw new TypeError('Failed to fetch');
      return answer;
    }
    if (!server) throw new Error(`This test has no server for ${url}.`);
    const length: Record<string, string> = typeof init.body === 'string' ? { 'content-length': String(new TextEncoder().encode(init.body).byteLength) } : {};
    const headers = { ...(init.headers as Record<string, string>), ...length, ...(server.cookie ? { cookie: server.cookie } : {}) };
    const answering = Promise.resolve(server.app.raw(url.slice('/api/'.length), { ...init, headers }));
    answered.add(answering);
    void answering.finally(() => answered.delete(answering)).catch(() => {});
    return abortable(await answering, init.signal);
  });
}

// What the stream box calls upstream gets the relay's answers too, so a test says once what the provider answers.
const viaStreams: Upstream = async (url, { method, headers, body, signal }) => {
  // The server's own price fetch leaves through the same outbound; runtime tests price nothing.
  if (url.origin === 'https://models.dev') return Response.json({});
  if (!relay) throw new Error('This test gave the relay no answers.');
  const answer = relay({ url: url.toString(), method: method as HttpRequest['method'], headers: Object.fromEntries(headers), body });
  if (!answer) throw new TypeError('Failed to fetch');
  return abortable(answer, signal);
};

function abortable(response: Response, signal: AbortSignal | null | undefined): Response {
  if (!response.body || !signal) return response;
  const reader = response.body.getReader();
  const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
  aborted.catch(() => reader.cancel());
  const read = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
  return new Response(read, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// The log holds what each call sent upstream, and when, in seconds after the stub was set.
export function stubRelay(answer: Relay): { at: number; sent: HttpRequest }[] {
  const log: { at: number; sent: HttpRequest }[] = [];
  const start = Date.now();
  relay = (sent) => {
    log.push({ at: (Date.now() - start) / 1000, sent });
    return answer(sent);
  };
  stubFetch();
  return log;
}

export const upstream = (status: number, body: unknown) => Response.json(body, { status, headers: { [RELAY_HEADER]: 'upstream' } });

export const inTurn = (answers: (Response | null)[]): Relay => () => answers.shift() ?? null;

export const saying = (text: string) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { [RELAY_HEADER]: 'upstream' } });

// The bytes of a picture as far as the import reads one: a PNG's signature.
export const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...randomBytes(16)]);

export const testModel: Model = { ...bareModel('m'), name: 'M' };
export const testConnection: Connection = { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-x' }], turns: null, starred: [testModel] };

// For a call made outside a session: a log no store releases, and a call's names.
export const testLog = () => new RequestLog({ subscribe: () => () => true, scopeState: () => 'loaded' });
export const LOGGED: Logged = { chat: null, purpose: 'reply', call: { connection: 'c', source: 'OpenRouter', model: 'm', modelName: 'M' } };

export async function answerable(session: Session): Promise<void> {
  const connection = await session.store.create('connection', testConnection);
  if (!connection.ok) throw new Error(connection.error);
  await setDefaultModel(session.store, 'main', { connection: connection.data.id, model: testModel.id });
}

// Gives each test in the file a server with no accounts. account() signs one up; each open() is one
// more device of it, and another vault key stands for a device that cannot read what it wrote.
export function testServer() {
  let app: App;
  const held: (() => void)[] = [];
  // A store left open pulls on after its test, through the next test's cookie and into its spies.
  const stores: ObjectStore[] = [];
  beforeAll(async () => {
    app = await testApp(viaStreams);
  });
  afterAll(() => app.dispose());
  beforeEach(async () => {
    await app.reset();
    holdAccount(null);
    server = { app, cookie: null };
    relay = null;
    stubFetch();
  });
  afterEach(async () => {
    for (const release of held.splice(0)) release();
    for (const store of stores.splice(0)) store.close();
    while (answered.size) await Promise.allSettled([...answered]);
    vi.unstubAllGlobals();
  });

  const harness = {
    async hold(store: ObjectStore, ...chats: string[]) {
      for (const chat of chats) {
        const lease = store.retainChat(chat);
        held.push(lease.release);
        const failure = await lease.ready;
        if (failure) throw new Error(failure.error);
      }
    },
    // The page holds the account it signed up, as AccountFlow does, so every request states it.
    async account(username?: string) {
      const body = signupBody(username);
      const cookie = sessionCookie(await app.post('signup', body));
      server!.cookie = cookie;
      const { accountId } = body;
      holdAccount(accountId);
      const vaultKey = randomBytes(32);
      const open = async (key: VaultKey = vaultKey) => {
        const store = await ObjectStore.open(accountId, key, serverBackend(api));
        stores.push(store);
        return store;
      };
      const store = await open();
      return { accountId, cookie, vaultKey, store, files: new Files(serverBackend(api), store), open };
    },
    // The operator deletes the account on the server, which opens signup again (server/accounts): how a user
    // who lost both the password and the recovery key starts over.
    wipe: () => app.reset(),
    // A session on an account of its own, closed when test ends. keepSynced listens on the window and
    // pulls only while the tab is visible, so a hidden one never pulls on its own.
    async withSession(test: (session: Session) => Promise<void>, tools?: Binding<ToolUnit, ToolEvent> | typeof createTools) {
      vi.stubGlobal('window', new EventTarget());
      vi.stubGlobal('document', { visibilityState: 'hidden' });
      const { accountId, vaultKey } = await harness.account();
      const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal, undefined, undefined, { tools: typeof tools === 'function' ? tools : tools && (({ store }) => ({
        ...tools, warm: async () => {}, menus: () => [], menusOf: () => [], draft: () => () => {}, page: () => () => {}, attach: () => () => {}, subscribe: () => () => {}, frames: () => new Map(), hosts: () => new Map(), trial: async () => null,
        items: (module) => store.get('tool', toolId(module))?.value.manifest.menu ?? [], actions: (module) => store.get('tool', toolId(module))?.value.manifest.actions ?? [], hears: () => true,
      })), lua: async () => {
        const machine = await lua;
        return { run: (chat, units, scope, event, host, lane, signal) => runEvent(machine, chat, units, scope, event, host, lane, signal), installDisplay: (...args) => machine.installDisplay(...args), display: (...args) => machine.display(...args), forgetDisplay: (...args) => machine.forgetDisplay(...args), check: (code) => machine.check(code), close: () => machine.close() };
      } });
      if (!opened.ok) throw new Error(opened.error);
      try {
        await test(opened.data);
      } finally {
        opened.data.close();
      }
    },
    passwordProof: { method: 'password', proof: signupBody().passwordProof } as const,
    // The server's clock, which stamps the stores' bookmarks: a restore names a time between two writes. reset() puts it back.
    at(now: () => number) {
      app.clock.now = now;
    },
    // What the daily job does for every live account: a baseline snapshot, stamped by the server's clock. A restore by
    // time lands on the newest baseline at or before that time.
    async baseline(accountId: string) {
      const incarnation = (await app.env.db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(accountId).first<string>('incarnation'))!;
      await app.stores.snapshot(incarnation);
    },
    // The first signup of a reset installation is its operator, so a test calls this before any account().
    operator: () => harness.account(),
    // The page holds this account (an account()'s) again, as after signing in to it, until the next account() or as().
    as({ accountId, cookie }: { accountId: string; cookie: string }) {
      server!.cookie = cookie;
      holdAccount(accountId);
    },
  };
  return harness;
}
