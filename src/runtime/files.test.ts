import { describe, expect, it, vi } from 'vitest';
import { serverBackend } from './backend';
import { randomBytes } from '../vault/aead';
import { sealFile } from '../vault/files';
import { api, type ApiResult } from './api';
import { addAssets, copyCharacter, createCharacter, removeAssets, restoreAssets, saveAssets } from './characters';
import { Files, HELD_AHEAD, inOrder, transferSlots, Transfers, TRANSFERS } from './files';
import { fillPictures, importRisuChats } from './move';
import { markDeleted } from './removal';
import { png, testServer } from './testing';

const server = testServer();

describe('files', () => {
  it('stores the same content as one file, whenever it is saved, and reads it back', async () => {
    const { files } = await server.account();
    const image = randomBytes(1024);
    const first = await files.save([image, image]);
    expect(first.ok && first.data[0]).toEqual((await sealFile(image)).ref);
    const again = await files.save([image]);
    expect(again).toEqual(first.ok && { ok: true, data: [first.data[0]] });
    expect(await files.read(first.ok ? first.data[0]! : { id: '', key: '' })).toEqual({ ok: true, data: image });
  });

  it('refuses a body opened with another file’s key', async () => {
    const { files } = await server.account();
    const saved = await files.save([randomBytes(64), randomBytes(64)]);
    const [a, b] = saved.ok ? saved.data : [];
    expect(await files.read({ id: a!.id, key: b!.key })).toEqual({ ok: false, error: 'unreadable' });
  });
});

describe('files uploading', () => {
  // Every id is missing on the server, and every PUT is held until let go one by one or all released.
  const heldPuts = async () => {
    const { store } = await server.account();
    const puts: (() => void)[] = [];
    let holding = true;
    const files = new Files(serverBackend(async <T,>(method: string, _path: string, body?: unknown) => {
      if (method === 'POST') return { ok: true as const, data: { missing: (body as { ids: string[] }).ids, maxBytes: 1 << 30, room: null } as T };
      return new Promise<ApiResult<T>>((done) => (holding ? puts.push(() => done({ ok: true, data: null as T })) : done({ ok: true, data: null as T })));
    }), store, new Transfers(TRANSFERS.multiplexed));
    const release = () => {
      holding = false;
      for (const put of puts) put();
    };
    return { files, puts, release };
  };

  it('starts the next upload as soon as any one ends, never more than 24 at once', async () => {
    const { files, puts, release } = await heldPuts();
    const saving = files.save(Array.from({ length: 30 }, () => randomBytes(64)));
    await vi.waitFor(() => expect(puts).toHaveLength(24));
    await new Promise((done) => setTimeout(done, 20));
    expect(puts).toHaveLength(24);
    puts[5]!();
    await vi.waitFor(() => expect(puts).toHaveLength(25));
    release();
    expect((await saving).ok).toBe(true);
  });

  it('reads the next window of assets while the one before it still uploads', async () => {
    const { files, puts, release } = await heldPuts();
    let reads = 0;
    const assets = Array.from({ length: 64 }, (_, at) => ({ name: `${at}`, read: async () => (reads++, png()) }));
    const saving = saveAssets(files, assets, () => {});
    await vi.waitFor(() => expect(puts).toHaveLength(24));
    expect(reads).toBe(64);
    release();
    const saved = await saving;
    expect(saved.ok && saved.data.kept.map(({ name }) => name)).toEqual(assets.map(({ name }) => name));
  });
});

describe('transfers', () => {
  it('removes a cancelled queued read before a slot opens without calling its backend', async () => {
    const { store } = await server.account();
    const queue = new Transfers(1);
    let release = () => {};
    const first = queue.run(() => new Promise<void>((resolve) => { release = resolve; }));
    const backend = serverBackend();
    const read = vi.spyOn(backend, 'readFile');
    const files = new Files(backend, store, queue);
    const stop = new AbortController();
    const reading = files.read((await sealFile(randomBytes(32))).ref, { signal: stop.signal });
    try {
      stop.abort();
      expect(await reading).toEqual({ ok: false, error: 'stopped' });
      expect(read).not.toHaveBeenCalled();
    } finally {
      release();
      await first;
    }
    await queue.run(async () => {});
    expect(read).not.toHaveBeenCalled();
  });

  it('passes an upload signal through the missing request and aborts its running fetch', async () => {
    const { store } = await server.account();
    const stop = new AbortController();
    let started!: (signal: AbortSignal) => void;
    const starting = new Promise<AbortSignal>((resolve) => { started = resolve; });
    let missingSignal: AbortSignal | undefined;
    let endFetch = () => {};
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
      const signal = init.signal!;
      if (init.method === 'POST') {
        missingSignal = signal;
        const { ids } = JSON.parse(init.body as string) as { ids: string[] };
        return Response.json({ missing: ids, maxBytes: 1 << 30, room: null });
      }
      started(signal);
      return new Promise<Response>((_resolve, reject) => {
        endFetch = () => reject(new DOMException('Stopped', 'AbortError'));
        signal.addEventListener('abort', endFetch, { once: true });
      });
    }));
    const files = new Files(serverBackend(), store, new Transfers(1));
    try {
      const saving = files.save([randomBytes(32)], { signal: stop.signal });
      const transferSignal = await starting;
      stop.abort();
      expect(transferSignal.aborted).toBe(true);
      expect(missingSignal?.aborted).toBe(true);
      expect(await saving).toEqual({ ok: false, error: 'stopped' });
    } finally {
      endFetch();
      vi.unstubAllGlobals();
    }
  });

  it('runs 4 at once over HTTP/1.1, whose connections the store shares, and 24 over a multiplexed one', () => {
    expect([transferSlots('http:', undefined), transferSlots('https:', 'http/1.1'), transferSlots('https:', 'h2'), transferSlots('https:', '')]).toEqual([4, 4, 24, 24]);
  });

  it('lets a picture on screen go before the bulk transfers waiting', async () => {
    const queue = new Transfers(1);
    const order: string[] = [];
    let free = () => {};
    const first = queue.run(() => new Promise<void>((done) => (free = done)), true);
    const bulk = queue.run(async () => void order.push('bulk'), true);
    const shown = queue.run(async () => void order.push('shown'));
    free();
    await Promise.all([first, bulk, shown]);
    expect(order).toEqual(['shown', 'bulk']);
  });

  it('starts ahead within the held bytes, the first whatever its size, and gives the results in order', async () => {
    const sizes = [HELD_AHEAD * 2, HELD_AHEAD / 2, HELD_AHEAD / 2, 1];
    const started: number[] = [];
    const ends = new Map<number, () => void>();
    const run = inOrder(sizes.map((_, at) => at), (at) => (started.push(at), new Promise<number>((done) => ends.set(at, () => done(at)))), { size: (at) => sizes[at]! });
    const taking = (async () => {
      const taken: number[] = [];
      for await (const [, result] of run) taken.push(result);
      return taken;
    })();
    await vi.waitFor(() => expect(started).toEqual([0]));
    ends.get(0)!();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    ends.get(2)!();
    ends.get(1)!();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    ends.get(3)!();
    expect(await taking).toEqual([0, 1, 2, 3]);
  });
});

describe('files on a bad link', () => {
  it('waits out a dropped connection while uploading, then saves', async () => {
    const { store } = await server.account();
    let dropped = 0;
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'PUT' && dropped++ === 0) return { ok: false as const, error: 'offline' };
      return api<T>(...args);
    }), store);
    const image = randomBytes(256);
    const saved = await files.save([image]);
    expect(saved).toEqual({ ok: true, data: [(await sealFile(image)).ref] });
    expect(dropped).toBe(2);
  });

  it('waits out a dropped connection while reading a picture, then opens it', async () => {
    const { store } = await server.account();
    let dropped = 0;
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'GET' && dropped++ === 0) return { ok: false as const, error: 'offline' };
      return api<T>(...args);
    }), store);
    const image = randomBytes(256);
    const saved = await files.save([image]);
    expect(saved.ok).toBe(true);
    expect(await files.read((saved as { ok: true; data: { id: string; key: string }[] }).data[0]!)).toEqual({ ok: true, data: image });
    expect(dropped).toBe(2);
  });

  it('ends a read that waits on a dead link when its signal aborts', async () => {
    const { store } = await server.account();
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => (args[0] === 'GET' ? { ok: false as const, error: 'offline' } : api<T>(...args))), store);
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);
    expect(await files.read({ id: 'a'.repeat(64), key: 'b'.repeat(43) }, { signal: abort.signal })).toEqual({ ok: false, error: 'stopped' });
  });

  it('never sends a body past the size the server names, and leaves it out of the result', async () => {
    const { store } = await server.account();
    const puts: string[] = [];
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'PUT') puts.push(args[1]);
      const result = await api<T>(...args);
      return args[1] === 'files/missing' && result.ok ? { ok: true as const, data: { ...(result.data as object), maxBytes: 100 } as T } : result;
    }), store);
    const [small, big] = [randomBytes(32), randomBytes(200)];
    const saved = await files.save([small, big]);
    expect(saved).toEqual({ ok: true, data: [(await sealFile(small)).ref, null] });
    expect(puts).toEqual([`files/${(await sealFile(small)).ref.id}`]);
  });

  it('sends no body past the room left under the picture cap, and leaves it out of the result', async () => {
    const { store } = await server.account();
    const [first, second] = [randomBytes(32), randomBytes(32)];
    const room = (await sealFile(first)).body.length;
    const puts: string[] = [];
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => {
      if (args[0] === 'PUT') puts.push(args[1]);
      const result = await api<T>(...args);
      return args[1] === 'files/missing' && result.ok ? { ok: true as const, data: { ...(result.data as object), room } as T } : result;
    }), store);
    const saved = await files.save([first, second]);
    expect(saved).toEqual({ ok: true, data: [(await sealFile(first)).ref, null] });
    expect(puts).toEqual([`files/${(await sealFile(first)).ref.id}`]);
  });
});

describe('the sweep', () => {
  it('releases the files no object names, keeps one named in 휴지통, takes back a released one an object names again, and releases nothing on a walk with a row it cannot read', async () => {
    const { store, files } = await server.account();
    const [shown, binned] = [crypto.randomUUID(), crypto.randomUUID()];
    await createCharacter(store, 'shown', shown);
    await createCharacter(store, 'binned', binned);
    const picked = (bytes: Uint8Array<ArrayBuffer>) => [{ name: 'a.png', arrayBuffer: async () => bytes.buffer }];
    await addAssets(store, files, shown, picked(png()));
    await addAssets(store, files, binned, picked(png()));
    await markDeleted(store, 'character', binned, Date.now());
    const loose = await files.save([png()]);
    const ref = loose.ok ? loose.data[0]! : null;
    // Past the hour an upload's claim holds it.
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      const scan = vi.spyOn(store, 'scan').mockImplementationOnce(async (_, visit) => {
        await visit({ id: 'x', kind: 'asset', parent: shown, rev: 1 }, undefined);
        return null;
      });
      expect(await files.release()).toEqual({ ok: false, error: 'unreadable' });
      scan.mockRestore();
      expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
      expect(await files.read(ref!)).toEqual({ ok: false, error: 'not-found' });
      await store.create('asset', { name: 'b', type: 'image/png', size: 24, file: ref! }, { parent: shown });
      expect(await files.release()).toEqual({ ok: true, data: { released: 0, taken: 0 } });
      expect((await files.read(ref!)).ok).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects a stale walk when another tab undoes an asset removal, and reclaims an undo written after a release', async () => {
    const { store, files, open } = await server.account();
    const owner = crypto.randomUUID();
    await createCharacter(store, 'kept', owner);
    await addAssets(store, files, owner, [{ name: 'a.png', arrayBuffer: async () => png().buffer }]);
    const asset = store.children('asset', owner)[0]!;
    const other = await open();
    await other.pull();
    await removeAssets(store, [asset.id]);
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    const scan = store.scan.bind(store);
    const walking = vi.spyOn(store, 'scan').mockImplementation(async (options, visit, pin, signal) => {
      const result = await scan(options, visit, pin, signal);
      if (options.kind === 'asset') expect((await restoreAssets(other, [asset])).ok).toBe(true);
      return result;
    });
    try {
      expect(await files.release()).toEqual({ ok: false, error: 'conflict' });
      expect((await files.read(asset.value.file)).ok).toBe(true);
      walking.mockRestore();
      await store.pull();
      await removeAssets(store, [asset.id]);
      clock.mockReturnValue(later + 2 * 60 * 60 * 1000);
      expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
      expect((await restoreAssets(store, [asset])).ok).toBe(true);
      expect((await files.read(asset.value.file)).ok).toBe(true);
    } finally {
      walking.mockRestore();
      clock.mockRestore();
    }
  });

  it('walks again, a bounded number of times, when a write lands mid-walk', async () => {
    const { files } = await server.account();
    const release = vi.spyOn(files, 'release').mockResolvedValue({ ok: false, error: 'conflict' });
    await files.sweep();
    expect(release).toHaveBeenCalledTimes(3);
  });

  it('takes back the file a pending character copy captured before another tab removed its last reference', async () => {
    const { store, files, open } = await server.account();
    const owner = crypto.randomUUID();
    await createCharacter(store, 'source', owner);
    await addAssets(store, files, owner, [{ name: 'a.png', arrayBuffer: async () => png().buffer }]);
    const asset = store.children('asset', owner)[0]!;
    const other = await open();
    await other.pull();
    let held!: () => void;
    const heldPromise = new Promise<void>((resolve) => { held = resolve; });
    let resume!: () => void;
    const resumePromise = new Promise<void>((resolve) => { resume = resolve; });
    const batch = store.batch.bind(store);
    const writing = vi.spyOn(store, 'batch').mockImplementationOnce(async (...args) => {
      held();
      await resumePromise;
      return batch(...args);
    });
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      const copying = copyCharacter(store, owner, 'copy', () => {});
      await heldPromise;
      expect((await removeAssets(other, [asset.id])).ok).toBe(true);
      expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
      resume();
      const copied = await copying;
      expect(copied.ok).toBe(true);
      expect(copied.ok && store.children('asset', copied.data)[0]?.value.file).toEqual(asset.value.file);
      expect((await files.read(asset.value.file)).ok).toBe(true);
    } finally {
      resume();
      writing.mockRestore();
      clock.mockRestore();
    }
  });

  it('bounds the combined named and unused ids of every sweep request', async () => {
    const { store } = await server.account();
    const pin = await store.pin();
    if (!pin.ok) throw new Error(pin.error);
    const held = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(64, '0'));
    const named = Array.from({ length: 500 }, (_, i) => (i + 1000).toString(16).padStart(64, '0'));
    const walking = vi.spyOn(store, 'scan').mockImplementation(async ({ kind }, visit) => {
      if (kind === 'asset') for (const id of named) await visit({ id, kind, parent: null, rev: 1 }, { file: { id } });
      return null;
    });
    const bodies: { unused: string[]; named: string[] }[] = [];
    const files = new Files(serverBackend(async <T,>(method: string, _path: string, body?: unknown) => {
      if (method === 'GET') return { ok: true, data: { ids: held, more: false, timeline: pin.data.timeline, rev: 0 } as T };
      const sent = body as typeof bodies[number];
      bodies.push(sent);
      return { ok: true, data: { released: sent.unused.length, taken: sent.named.length } as T };
    }), store);
    try {
      expect(await files.release()).toEqual({ ok: true, data: { released: 1000, taken: 500 } });
      expect(bodies).toHaveLength(2);
      for (const body of bodies) expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(100_000);
      expect(bodies.flatMap(({ unused }) => unused)).toEqual(held);
      expect(bodies.flatMap(({ named }) => named)).toEqual(named);
    } finally {
      walking.mockRestore();
    }
  });

  it('walks the pictures held by chats too, so an inlay is never taken for unused', async () => {
    const { store, files } = await server.account();
    const made = await importRisuChats(store, null, [{ title: 't', note: null, persona: null, greeting: 0, variables: [], inlays: [], lore: [], loreFolders: [], messages: [{ role: 'user', text: 'hi', at: 1 }] }]);
    const chat = made.ok ? made.data[0]! : '';
    await server.hold(store, chat);
    expect(await fillPictures(store, files, { kind: 'inlay', parent: chat }, [{ name: 'a', read: async () => png() }])).toMatchObject({ ok: true, data: { unsupported: [] } });
    const later = Date.now() + 2 * 60 * 60 * 1000;
    const settled = vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      expect(await files.release()).toEqual({ ok: true, data: { released: 0, taken: 0 } });
    } finally {
      settled.mockRestore();
    }
  });
});
