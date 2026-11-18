import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS } from './http';
import type { Upstream } from './relay';
import { relayBudget } from './limits';
import { streamRegistry as registryWithBudget } from './stream-registry';
import { streamStore, type StreamStore } from './db/streams-db';
import { replyKey } from './testing';

const streamRegistry = (store: StreamStore, upstream: Upstream) => registryWithBudget(store, upstream, relayBudget());

const CHUNK = 64 * 1024;
const staying = new AbortController().signal;

// A provider that gives chunks bytes at once and then answers only when the call is aborted. calls: how many calls
// reached it; aborted: how many of them were aborted.
function provider(chunks = 0) {
  const seen = { calls: 0, aborted: 0 };
  const upstream: Upstream = async (_url, { signal }) => {
    seen.calls++;
    signal.addEventListener('abort', () => seen.aborted++);
    let given = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull: (body) => {
          if (signal.aborted) return body.error(signal.reason);
          if (given++ < chunks) return body.enqueue(new Uint8Array(CHUNK));
          return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(body.error(signal.reason))));
        },
      }),
    );
  };
  return { seen, upstream };
}

async function body() {
  const { key } = await replyKey();
  return { id: crypto.randomUUID(), key, request: { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' }, bytes: 0 };
}

async function types(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const seen: number[] = [];
  for (let at = 0; at < bytes.byteLength; at += 4 + new DataView(bytes.buffer, at).getUint32(0)) seen.push(bytes[at + 4]!);
  return seen;
}

const opened: StreamStore[] = [];
const dirs: string[] = [];
const store = (path = ':memory:') => {
  const made = streamStore(path);
  opened.push(made);
  return made;
};
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-streams-'));
  dirs.push(dir);
  return join(dir, 'streams.sqlite');
};

afterEach(() => {
  for (const each of opened.splice(0)) each.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the stream registry', () => {
  it('gives two starts of one name one call and one stream-exists', async () => {
    const { seen, upstream } = provider();
    const streams = streamRegistry(store(), upstream);
    const [a, b] = await Promise.all([streams.start('a', await body(), staying, () => {}), streams.start('a', await body(), staying, () => {})]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    await vi.waitFor(() => expect(seen.calls).toBe(1));
    expect(streams.live()).toBe(1);
    await streams.drop('a');
    expect(streams.live()).toBe(0);
  });

  // The start's key derivation waits until the returned open() is called.
  const holdDerivation = () => {
    const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const spy = vi.spyOn(crypto.subtle, 'deriveKey').mockImplementationOnce(async (...args) => {
      await gate;
      return derive(...args);
    });
    return { open, restore: () => spy.mockRestore() };
  };

  it('keeps a starting stream through a read that found nothing yet, so its call stays counted and stoppable', async () => {
    const { seen, upstream } = provider();
    const streams = streamRegistry(store(), upstream);
    const held = holdDerivation();
    try {
      const starting = streams.start('a', await body(), staying, () => {});
      expect((await streams.read('a', 0, staying)).status).toBe(404);
      held.open();
      const started = await starting;
      expect(started.status).toBe(200);
      await started.body?.cancel();
      expect(streams.live()).toBe(1);
      streams.stop('a');
      await streams.settled();
      expect([seen.calls, seen.aborted]).toEqual([1, 1]);
    } finally {
      held.restore();
    }
  });

  it('refuses a start whose stream was deleted while its key was derived, before any row or call', async () => {
    const { seen, upstream } = provider();
    const held = store();
    const streams = streamRegistry(held, upstream);
    const derivation = holdDerivation();
    try {
      const starting = streams.start('a', await body(), staying, () => {});
      await streams.drop('a');
      derivation.open();
      expect((await starting).status).toBe(404);
      expect(seen.calls).toBe(0);
      expect(streams.live()).toBe(0);
      expect(held.due(Number.MAX_SAFE_INTEGER)).toEqual([]);
    } finally {
      derivation.restore();
    }
  });

  it('counts a call live from its start to its end, and settles once none runs', async () => {
    const { upstream } = provider();
    const streams = streamRegistry(store(), upstream);
    await (await streams.start('a', await body(), staying, () => {})).body?.cancel();
    await (await streams.start('b', await body(), staying, () => {})).body?.cancel();
    expect(streams.live()).toBe(2);
    let settled = false;
    const settling = streams.settled().then(() => (settled = true));
    streams.stop('a');
    await vi.waitFor(() => expect(streams.live()).toBe(1));
    expect(settled).toBe(false);
    streams.stop('b');
    await settling;
    expect(streams.live()).toBe(0);
  });

  it('drops an account\'s oldest streams as it starts one past the bytes it may keep, and no other account\'s', async () => {
    const { seen, upstream } = provider();
    const streams = registryWithBudget(store(), upstream, relayBudget(), 0);
    for (const name of ['u:1', 'v:1', 'u:2']) await (await streams.start(name, await body(), staying, () => {})).body?.cancel();
    expect(seen.aborted).toBe(1);
    expect((await streams.read('u:1', 0, staying)).status).toBe(404);
    for (const name of ['v:1', 'u:2']) {
      const kept = await streams.read(name, 0, staying);
      expect(kept.status).toBe(200);
      await kept.body?.cancel();
    }
    streams.stop('v:1');
    streams.stop('u:2');
    await streams.settled();
  });

  it('expires a stream at its alarm: the call ends and its rows go', async () => {
    const { seen, upstream } = provider();
    const streams = streamRegistry(store(), upstream);
    await (await streams.start('a', await body(), staying, () => {})).body?.cancel();
    await streams.expire(Date.now() + DAY_MS - 60_000);
    expect(streams.live()).toBe(1);
    await streams.expire(Date.now() + DAY_MS);
    expect(streams.live()).toBe(0);
    expect(seen.aborted).toBe(1);
    expect((await streams.read('a', 0, staying)).status).toBe(404);
  });

  it('writes no page after an expiry that came while a page was being written', async () => {
    const held = store();
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    let writing = false;
    const storage = held.storage;
    held.storage = (name) => {
      const inner = storage(name);
      return {
        ...inner,
        put: async (key, value) => {
          writing = true;
          await gate;
          return inner.put(key, value);
        },
      };
    };
    const streams = streamRegistry(held, provider(5).upstream);
    await (await streams.start('a', await body(), staying, () => {})).body?.cancel();
    await vi.waitFor(() => expect(writing).toBe(true));
    const expiring = streams.expire(Date.now() + DAY_MS);
    open();
    await expiring;
    expect((await held.storage('a').list({ start: 'f:', end: 'f;', limit: 10 })).size).toBe(0);
    expect(held.due(Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  it('ends its readers, clears the count and forgets the box when a write fails', async () => {
    const held = store();
    const storage = held.storage;
    held.storage = (name) => ({
      ...storage(name),
      put: async () => {
        throw new Error('disk full');
      },
    });
    const { seen, upstream } = provider(5);
    const streams = streamRegistry(held, upstream);
    const reading = (await streams.start('a', await body(), staying, () => {})).arrayBuffer();
    await expect(reading).rejects.toThrow('stream write failed');
    await vi.waitFor(() => expect(streams.live()).toBe(0));
    expect(seen.aborted).toBe(1);
    // The box is gone: a new reader reads the stored hello and then a lost stream.
    expect(await types(await streams.read('a', 0, staying))).toEqual([0]);
  });

  it('serves a stream that a restart cut before its end from its pages, then as lost, without calling again', async () => {
    const path = tempFile();
    const { seen, upstream } = provider(5);
    const before = streamRegistry(store(path), upstream);
    const reading = (await before.start('a', await body(), staying, () => {})).body!.getReader();
    // The fourth data frame would take the page past its bytes, so the head and three data frames are written at once.
    const stored = store(path).storage('a');
    await vi.waitFor(async () => expect((await stored.list({ start: 'f:0000000001', end: 'f;', limit: 1 })).size).toBe(1));

    const after = streamRegistry(store(path), upstream);
    const seenAfter = await types(await after.read('a', 2, staying));
    expect(seenAfter[0]).toBe(0);
    expect(seenAfter.slice(1)).toEqual([1, 2, 2, 2]);
    expect(seen.calls).toBe(1);

    await reading.cancel();
    before.stop('a');
    await before.settled();
  });
});
