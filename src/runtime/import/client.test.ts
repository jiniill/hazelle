import { afterEach, describe, expect, it, vi } from 'vitest';
import { importCard } from '../../engine/import/card';
import type { RisuChat } from '../../engine/import/types';
import { ImportWorker } from './client';
import { ImportReadError, ImportStuck, type CharacterData, type Down, type Replies, type Request, type Up } from './protocol';

vi.mock('./worker?worker&url', () => ({ default: '/import-worker.js' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function transport(reply?: (request: Request) => { result: Replies[keyof Replies] } | { error: string }) {
  const worker = {
    onmessage: null as ((event: MessageEvent<Up>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn((down: Down) => {
      if (!reply || !('request' in down)) return;
      const data = { id: down.id, ...reply(down.request) };
      queueMicrotask(() => worker.onmessage?.({ data } as MessageEvent<Up>));
    }),
    terminate: vi.fn(),
  };
  const construct = vi.fn(function () { return worker; });
  vi.stubGlobal('Worker', construct);
  const asked = () => worker.postMessage.mock.calls.flatMap(([down]) => ('request' in down ? [down.request] : []));
  return { worker, construct, asked };
}

const file = () => new File(['{}'], 'card.json');
const catalog: Replies['backup'] = { ok: true, catalog: {
  pictures: 0,
  pictureBytes: 0,
  characters: [{ key: 7, id: 'selected', name: 'Selected', chatCount: 2, assetCount: 0, inlayCount: 0, lastTalk: 4 }],
  personas: [], presets: [], modules: [], alwaysModules: [], loreBudget: null, toggles: {}, unsupported: [],
} };

const result = await importCard('card.json', new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Selected' } })));
function character(): CharacterData {
  if (!result.ok || !('card' in result)) throw new Error('card did not import');
  return { ...result.card, avatar: 1, assets: [], id: 'selected', folder: null, chatFolders: [], modules: [], missed: [], chatCount: 2 };
}

describe('ImportWorker', () => {
  it('opens lazily and cancellation rejects every pending request without restarting the worker', async () => {
    const { worker, construct } = transport();
    const client = new ImportWorker();
    expect(construct).not.toHaveBeenCalled();
    const pending = Promise.allSettled([client.backup([file()]), client.card(file(), false)]);
    expect(construct).toHaveBeenCalledExactlyOnceWith('/import-worker.js', { type: 'module' });
    client.close();
    client.close();
    const results = await pending;
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('request did not reject');
      expect(result.reason).toBeInstanceOf(ImportReadError);
      expect(result.reason.message).toBe('closed');
    }
    await expect(client.card(file(), false)).rejects.toThrow('closed');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(construct).toHaveBeenCalledOnce();
  });

  it('rejects pending imports after a worker crash and refuses subsequent work', async () => {
    const { worker, construct } = transport();
    const client = new ImportWorker();
    const pending = Promise.allSettled([client.backup([file()]), client.card(file(), false)]);
    worker.onerror?.({ message: 'worker crashed' } as ErrorEvent);
    for (const result of await pending) {
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('request did not reject');
      expect(result.reason).toBeInstanceOf(ImportReadError);
      expect(result.reason.message).toBe('worker crashed');
    }
    await expect(client.backup([file()])).rejects.toThrow('closed');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(construct).toHaveBeenCalledOnce();
  });

  it('ends a loaded worker that leaves its pings unanswered past the stuck limit, and refuses further work', async () => {
    vi.useFakeTimers();
    const { worker } = transport();
    const client = new ImportWorker();
    const failed = client.card(file(), false).catch((error: unknown) => error);
    worker.onmessage?.({ data: { pong: true } } as MessageEvent<Up>);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await failed).toBeInstanceOf(ImportStuck);
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(client.card(file(), false)).rejects.toThrow('closed');
  });

  it('fetches only a selected character, assembles pages in order, and releases the worker history', async () => {
    const chats: RisuChat[] = [
      { title: 'First', note: null, persona: null, greeting: 0, variables: [], inlays: [], lore: [], loreFolders: [], memory: [], folder: null, staged: true, messages: [
        { role: 'user', text: 'one', at: 1 },
        { role: 'assistant', text: 'two', reasoning: 'thought', at: 2 },
        { role: 'user', text: 'three', at: 3 },
      ] },
      { title: 'Second', note: 'note', persona: 'persona', greeting: 1, variables: [['mood', 'calm']], inlays: [], lore: [], loreFolders: [], memory: [], folder: null, staged: true, messages: [{ role: 'assistant', text: 'four', at: 4 }] },
    ];
    const { asked } = transport((request) => {
      switch (request.kind) {
        case 'backup': return { result: catalog };
        case 'character': return { result: character() };
        case 'chat': {
          const { messages, ...header } = chats[request.index]!;
          return { result: { header, messages: messages.length } };
        }
        case 'messages': {
          const messages = chats[request.index]!.messages.slice(request.from, request.from + 2);
          return { result: { messages, next: request.from + messages.length } };
        }
        case 'release': return { result: null };
        default: throw new Error(`unexpected request: ${request.kind}`);
      }
    });
    const client = new ImportWorker();
    const result = await client.backup([file()]);
    if (!result.ok) throw new Error(result.failure.kind);
    expect(asked().map((request) => request.kind)).toEqual(['backup']);
    const selected = await result.backup.character(7);
    expect(selected.chats).toEqual(chats);
    expect(asked().slice(1)).toEqual([
      { kind: 'character', key: 7 },
      { kind: 'chat', index: 0 },
      { kind: 'messages', index: 0, from: 0 },
      { kind: 'messages', index: 0, from: 2 },
      { kind: 'chat', index: 1 },
      { kind: 'messages', index: 1, from: 0 },
      { kind: 'release' },
    ]);
    client.close();
  });

  it('releases selected histories after a page fails before surfacing the read error', async () => {
    const { worker, asked } = transport((request) => {
      switch (request.kind) {
        case 'backup': return { result: catalog };
        case 'character': return { result: character() };
        case 'chat': return { result: { header: { title: 'First', note: null, persona: null, greeting: 0, variables: [], inlays: [], lore: [], loreFolders: [], memory: [], folder: null, staged: true }, messages: 1 } };
        case 'messages': return { error: 'page unreadable' };
        case 'release': return { result: null };
        default: throw new Error(`unexpected request: ${request.kind}`);
      }
    });
    const client = new ImportWorker();
    const result = await client.backup([file()]);
    if (!result.ok) throw new Error(result.failure.kind);
    await expect(result.backup.character(7)).rejects.toThrow(new ImportReadError('page unreadable'));
    expect(asked().map((request) => request.kind)).toEqual(['backup', 'character', 'chat', 'messages', 'release']);
    expect(worker.terminate).not.toHaveBeenCalled();
    client.close();
  });
});
