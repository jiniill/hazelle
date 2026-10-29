import { TOOL_VARIABLES, type Json, type Settings } from '../tool-api/manifest';
import type { ChatHeader, Down, EventName, Message, Method, Port, ToolOutcome, Up } from '../tool-api/protocol';

type Load = Extract<Down, { kind: 'load' }>;
type Buffer = {
  writes: Map<string, Json | undefined>; edits: Map<number, string>; added: ToolOutcome['added']; data: Map<string, Json | undefined>; badges: Map<number, string | null>;
  lore: Map<string, ToolOutcome['lore'][number]>; variables: Map<string, string>;
};
const buffer = (): Buffer => ({ writes: new Map(), edits: new Map(), added: [], data: new Map(), badges: new Map(), lore: new Map(), variables: new Map() });
const empty = (pending: Buffer) => !pending.writes.size && !pending.edits.size && !pending.added.length && !pending.data.size && !pending.badges.size && !pending.lore.size && !pending.variables.size;
const outcome = (pending: Buffer, value?: ToolOutcome['value']): ToolOutcome => ({
  value, writes: [...pending.writes], edits: [...pending.edits].map(([index, text]) => ({ index, text })), added: pending.added,
  data: [...pending.data], badges: [...pending.badges].map(([index, text]) => ({ index, text })), lore: [...pending.lore.values()], variables: [...pending.variables],
});
// An event about the user's own change must not rewrite the story under them, nor one inside a turn or a showing.
const STORY_LOCKED = new Set<EventName>(['change', 'branch', 'replying', 'sending', 'requesting', 'showing', 'tool']);
// Nothing a showing answers is saved, so a write there would be lost.
const QUIET = new Set<EventName>(['showing']);
const ANSWERS = new Set<EventName>(['replying', 'sending', 'requesting', 'showing', 'input', 'tool']);
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
// The name a plugin's code runs under, so a stack names its lines (lineOf), which are the file's.
export const sourced = (code: string) => `${code}\n//# sourceURL=hazelle-plugin.js`;
const lineOf = (error: unknown) => {
  const line = error instanceof Error ? /hazelle-plugin\.js:(\d+)/.exec(error.stack ?? '')?.[1] : undefined;
  return line === undefined ? {} : { line: Number(line) };
};

export function connectApi(port: Port, execute: (code: string, api: Hazelle.Api) => void | Promise<void>): () => void {
  let load: Load | null = null;
  let calls = 0;
  let closed = false;
  let loaded = false;
  let history: Message[] = [];
  let pageWrites = buffer();
  let pageFlush = false;
  let pageSent: Buffer | null = null;
  const landing: (() => void)[] = [];
  // The page's writes all sent and answered.
  const landed = () => !pageFlush && !pageSent && empty(pageWrites) ? Promise.resolve() : new Promise<void>((resolve) => landing.push(resolve));
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const handlers = new Map<EventName, ((...args: never[]) => unknown)[]>();
  const storageListeners = new Set<(keys: string[]) => void>();
  const send = (message: Up) => { if (!closed) port.postMessage(message); };
  const call = <T>(method: Method, args: unknown[], event?: number, signal?: AbortSignal): Promise<T> => {
    if (closed) return Promise.reject(new Error('closed'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = ++calls;
    return new Promise<T>((resolve, reject) => {
      const abort = () => { waiting.delete(id); send({ kind: 'cancel', call: id }); reject(signal!.reason); };
      const settled = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      waiting.set(id, { resolve: (value) => { settled(); resolve(value as T); }, reject: (error) => { settled(); reject(error); } });
      send({ kind: 'call', call: id, method, args, ...(event === undefined ? {} : { event }) });
    });
  };
  const fire = (method: Method, args: unknown[], event?: number) => { void call(method, args, event).catch(() => {}); };
  const flushPage = () => {
    if (pageFlush || pageSent) return;
    pageFlush = true;
    queueMicrotask(() => {
      pageFlush = false;
      if (empty(pageWrites)) { for (const resolve of landing.splice(0)) resolve(); return; }
      const pending = pageSent = pageWrites;
      pageWrites = buffer();
      send({ kind: 'done', id: 0, outcome: outcome(pending) });
    });
  };

  const chatOf = (header: ChatHeader, event?: number, writes = buffer(), locked = false, quiet = false): Hazelle.Chat => {
    const pending = () => { if (quiet) throw new Error('Nothing is saved in this event'); return event === undefined ? pageWrites : writes; };
    const changed = () => { if (event === undefined) flushPage(); };
    const story = () => { if (locked) throw new Error('The story cannot be changed in this event'); };
    const overlaid = async <T extends Json>(layer: 'writes' | 'data' | 'variables', method: 'chat.state.get' | 'chat.data.get' | 'chat.variables.get', key: string): Promise<T | undefined> => {
      const current = (event === undefined ? pageWrites : writes)[layer];
      if (current.has(key)) return current.get(key) as T | undefined;
      if (event === undefined && pageSent?.[layer].has(key)) return pageSent[layer].get(key) as T | undefined;
      return call<T | undefined>(method, [key], event);
    };
    return {
      ...header,
      messages: async (from, to) => {
        const tail = await call<{ from: number; items: Message[] }>('chat.messages', [], event);
        history = [...history.slice(0, tail.from), ...tail.items];
        return history.slice(from, to);
      },
      greeting: () => call<string | null>('chat.greeting', [], event),
      card: () => call<Hazelle.Card | null>('chat.card', [], event),
      state: {
        get: <T extends Json>(key: string) => overlaid<T>('writes', 'chat.state.get', key),
        set: (key, value) => { pending().writes.set(key, value); changed(); },
        delete: (key) => { pending().writes.set(key, undefined); changed(); },
      },
      variables: {
        get: (name) => overlaid<string>('variables', 'chat.variables.get', name),
        set: (name, value) => {
          if (name.startsWith(TOOL_VARIABLES)) throw new Error(`A chat variable named ${TOOL_VARIABLES}… is a tool's own state`);
          pending().variables.set(name, String(value));
          changed();
        },
      },
      data: {
        get: <T extends Json>(key: string) => overlaid<T>('data', 'chat.data.get', key),
        set: (key, value) => { pending().data.set(key, value); changed(); },
        delete: (key) => { pending().data.set(key, undefined); changed(); },
        keys: async () => {
          const keys = new Set(await call<string[]>('chat.data.keys', [], event));
          for (const layer of [...(event === undefined && pageSent ? [pageSent.data] : []), pending().data]) {
            for (const [key, value] of layer) {
              if (value === undefined) keys.delete(key);
              else keys.add(key);
            }
          }
          return [...keys];
        },
      },
      edit: (index, text) => { story(); pending().edits.set(index, text); changed(); },
      add: (role, text) => { story(); pending().added.push({ role, text }); changed(); },
      writeLore: ({ name, keys, text, always, on }) => { pending().lore.set(name, { name, keys: [...keys], text, always, on }); changed(); },
      model: (role, messages) => call('model', [role, messages], event),
      embed: (texts, as) => call('embed', [texts, as ?? null], event),
      fetch: (url, { method = 'GET', headers = {}, body, signal } = {}) => call('fetch', [url, { method, headers, body: body ?? null }], event, signal),
      badge: (index, text) => { pending().badges.set(index, text); changed(); },
      // Bound to the chat, not the event: a picture often lands after its event has ended.
      picture: (at, bytes, options) => call('chat.picture', [header.id, at, bytes, options?.caption ?? null]),
      tokens: (text) => call('tokens', [text], event),
      lore: (reserve) => call('lore', [reserve ?? null], event),
      lorebook: () => call('chat.lorebook', [], event),
      send: async (text) => { await landed(); return call('chat.send', [header.id, text]); },
      rendered: (at) => call('chat.rendered', [header.id, at]),
      setup: () => call('chat.setup', [], event),
      ask: (question) => call('ask', [question], event),
      say: (text, tone = 'normal') => fire('say', [tone, text], event),
    };
  };

  const dispatch = async (event: EventName, args: unknown[]) => {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = await handler(...args as never[]);
    return result;
  };
  const failed = (id: number, error: unknown) => send({ kind: 'failed', id, message: describe(error), ...lineOf(error) });

  port.onmessage = ({ data }: MessageEvent<Down>) => {
    if (closed) return;
    if (data.kind === 'ping') return send({ kind: 'pong' });
    if (data.kind === 'answer') {
      // Call zero acknowledges a page flush; keep its overlay until the host has applied the write.
      if (data.call === 0 && pageSent) {
        pageSent = null;
        if (!data.ok) failed(0, data.value);
        flushPage();
        return;
      }
      const waiter = waiting.get(data.call);
      if (!waiter) return;
      waiting.delete(data.call);
      if (data.ok) waiter.resolve(data.value);
      else waiter.reject(new Error(String(data.value)));
      return;
    }
    if (data.kind === 'load') {
      if (load) return;
      load = data;
      const api: Hazelle.Api = {
        api: 1,
        tool: { name: data.manifest.name, author: data.manifest.author, displayName: data.manifest.displayName, version: data.manifest.version },
        context: data.role,
        on: (event, handler) => {
          if (data.role === 'page' && event !== 'message') throw new Error('Only message listeners run on a page');
          const list = handlers.get(event) ?? [];
          handlers.set(event, [...list, handler as (...args: never[]) => unknown]);
          if (loaded) send({ kind: 'loaded', listens: [...handlers.keys()] });
        },
        storage: {
          get: (key) => call('storage.get', [key]),
          set: (key, value) => call('storage.set', [key, value]),
          delete: (key) => call('storage.delete', [key]),
          keys: () => call('storage.keys', []),
          onChange: (listener) => { storageListeners.add(listener); return () => { storageListeners.delete(listener); }; },
        },
        assets: {
          save: (bytes) => call('assets.save', [bytes]),
          read: (name) => call('assets.read', [name]),
        },
        settings: () => call<Settings>('settings', []),
        setSetting: (key, value) => call('settings.set', [key, value]),
        account: () => call('account', []),
        post: (data) => fire('post', [data]),
        page: data.role === 'page' ? { chat: data.chat && chatOf(data.chat), theme: data.theme, close: () => fire('page.close', []) } : null,
        frame: data.role === 'frame' ? {
          chat: async () => { const header = await call<ChatHeader | null>('frame.chat', []); return header && chatOf(header); },
          show: () => fire('frame.show', []),
          hide: () => fire('frame.hide', []),
          menu: (items) => fire('frame.menu', [items]),
          actions: (items) => call('frame.actions', [items]),
          missing: (name) => fire('frame.missing', [name]),
        } : null,
      };
      void Promise.resolve().then(() => execute(data.code, api)).then(() => {
        loaded = true;
        send({ kind: 'loaded', listens: [...handlers.keys()] });
      }, (error: unknown) => send({ kind: 'load-failed', message: describe(error), ...lineOf(error) }));
      return;
    }
    if (!load) return;
    if (data.kind === 'storage') {
      for (const listener of storageListeners) void Promise.resolve().then(() => listener(data.keys)).catch((error: unknown) => failed(0, error));
      return;
    }
    if (data.kind === 'message') { void dispatch('message', [data.data]).catch((error: unknown) => failed(0, error)); return; }
    if (data.kind === 'settings') { void dispatch('settings', [data.values]).catch((error: unknown) => failed(0, error)); return; }
    if (data.kind === 'open') { void dispatch('open', []).catch((error: unknown) => failed(0, error)); return; }
    if (data.kind === 'event') {
      const pending = buffer();
      const chat = data.chat && chatOf(data.chat, data.id, pending, STORY_LOCKED.has(data.event), QUIET.has(data.event));
      const args = {
        reply: [chat, data.reply], replying: [chat, data.text], sending: [chat, data.text], requesting: [chat, data.messages], showing: [chat, data.shown], prompt: [chat, data.turn],
        change: [chat, data.change], branch: [chat, data.from], menu: [chat, data.item], action: [chat, data.item, data.message], input: [chat, data.item, data.text], tool: [chat, data.name, data.args],
      }[data.event as string] ?? [chat];
      const answer = (value: unknown) => data.event === 'prompt' ? (value as Hazelle.PromptAnswer | undefined) ?? null : ANSWERS.has(data.event) && value !== null ? value as ToolOutcome['value'] : undefined;
      // The host checks the answer's shape; one the port cannot carry fails the event here.
      void dispatch(data.event, args).then((value) => send({ kind: 'done', id: data.id, outcome: outcome(pending, answer(value)) })).catch((error: unknown) => failed(data.id, error));
    }
  };
  port.start();
  return () => {
    closed = true;
    port.onmessage = null;
    port.close();
    for (const waiter of waiting.values()) waiter.reject(new Error('closed'));
    waiting.clear();
    storageListeners.clear();
    handlers.clear();
  };
}
