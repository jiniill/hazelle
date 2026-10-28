import { strToU8, zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import type { Kind, Stored } from '../model/kinds';
import { sealFile, type FileRef } from '../vault/files';
import { restoreBackup, type RestoreStore } from './backup-core';
import { exportBackup, readBackup, type BackupOutput } from './testing/backup';
import type { ObjectStore } from './store';
import * as zip from './backup-zip';

const persona = (id: string, rev: number): Stored<'persona'> => ({ id, rev, kind: 'persona', parent: null, value: { name: id, description: '이야기 '.repeat(100), picture: null } });

const missing = async () => ({ ok: true as const, data: { missing: new Set<string>(), maxBytes: 0, room: null } });

const PIN = { timeline: 't', epoch: 0 };
const pins: Pick<ObjectStore, 'pin' | 'pinned' | 'list'> = { pin: async () => ({ ok: true, data: PIN }), pinned: (run) => run(PIN), list: () => [] };

function destination() {
  const parts: BlobPart[] = [];
  const output: BackupOutput = {
    write: vi.fn(async (chunk) => { parts.push(chunk); }),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => { parts.length = 0; }),
  };
  return { output, file: () => new Blob(parts) };
}

function store(objects: Stored<Kind>[] = []) {
  const held = new Map(objects.map((object) => [object.id, object]));
  const written: string[] = [];
  const api: Pick<ObjectStore, 'scan' | 'batch' | 'pin' | 'pinned' | 'list'> & RestoreStore = {
    ...pins,
    saveSummaries: async () => null,
    scan: async (options, visit) => {
      for (const { value, ...row } of [...held.values()].sort((a, b) => a.rev - b.rev)) await visit(row, options.metadata ? undefined : value);
      return null;
    },
    batch: async (writes, progress = () => {}) => {
      for (const write of writes) {
        if (write.type === 'remove') held.delete(write.id);
        else if ('value' in write) {
          const { id, kind, parent, value } = write;
          held.set(id, { id, kind, parent, value, rev: held.size + 1 } as Stored<Kind>);
          written.push(write.id);
        }
        progress(write);
      }
      return { ok: true, data: null };
    },
  };
  return { api, held, written };
}

async function pictureObjects() {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const { ref } = await sealFile(bytes);
  const character: Stored<'character'> = {
    id: 'character', kind: 'character', parent: null, rev: 3,
    value: {
      card: {
        name: '달', nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '',
        postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false,
        bias: [], regex: [], triggers: [], loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
      },
      folder: null, loreFolders: [],
    },
  };
  const avatar: Stored<'avatar'> = { id: 'avatar', kind: 'avatar', parent: character.id, rev: 1, value: { file: ref, type: 'image/png', size: bytes.length, thumb: '' } };
  return { bytes, ref, objects: [avatar, persona('person', 2), character] };
}

async function backup(file: Blob) {
  // A dropped file may only be read in slices, never materialized as a whole buffer.
  vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('whole file read'));
  const result = await readBackup(file);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.backup;
}

it('round-trips streamed objects and files and filters unreachable objects from metadata', async () => {
  const source = await pictureObjects();
  const orphan = { ...persona('unused', 4), kind: 'entry', parent: 'gone', value: { type: 'message', role: 'user', at: 0, text: 'gone', receipt: null } } as Stored<'entry'>;
  const old = store([...source.objects, orphan]);
  const target = destination();
  const read = vi.fn(async () => ({ ok: true as const, data: source.bytes }));
  const asked = vi.fn(missing);
  expect(await exportBackup(old.api, { read, missing: asked }, target.output)).toEqual({ ok: true, data: { left: 0, skipped: 0 } });
  const opened = await backup(target.file());
  const next = store();
  const save = vi.fn(async (bytes: Uint8Array<ArrayBuffer>[]) => ({ ok: true as const, data: await Promise.all(bytes.map(async (bytes) => (await sealFile(bytes)).ref)) }));
  expect(await restoreBackup(next.api, { save }, opened)).toEqual({ ok: true, data: { skipped: 0 } });
  expect(save).toHaveBeenCalledExactlyOnceWith([source.bytes], { signal: expect.any(AbortSignal) });
  for (const object of source.objects) expect(next.held.get(object.id)).toMatchObject({ ...object, rev: expect.any(Number) });
  expect(next.held.size).toBe(source.objects.length);
  expect(read).toHaveBeenCalledTimes(1);
  expect(asked).toHaveBeenCalledExactlyOnceWith([source.ref.id], expect.any(AbortSignal));
});

it('restores a backup built by the previous zipSync format', async () => {
  const source = await pictureObjects();
  const file = new Blob([zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'risu-alpha-backup', version: 3 })),
    'objects.jsonl': strToU8(source.objects.map((object) => JSON.stringify(object)).join('\n')),
    [`files/${source.ref.id}`]: [source.bytes, { level: 0 }],
  })]);
  const opened = await backup(file);
  const next = store();
  expect(await restoreBackup(next.api, { save: async () => ({ ok: true, data: [source.ref] }) }, opened)).toEqual({ ok: true, data: { skipped: 0 } });
  expect(next.held.size).toBe(source.objects.length);
});

it('serializes each decrypted body before releasing it and backpressures a slow destination', async () => {
  const count = 1024;
  let decrypted = 0;
  let written = 0;
  let streamed = false;
  const output: BackupOutput = {
    write: async () => {
      const before = decrypted;
      if (decrypted > 0 && decrypted < count) streamed = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(decrypted).toBe(before);
      written++;
    },
    close: async () => {}, abort: async () => {},
  };
  const scan: ObjectStore['scan'] = async (options, visit) => {
    for (let i = 0; i < count; i++) {
      const { value, ...row } = persona(String(i), i);
      if (options.metadata) { await visit(row, undefined); continue; }
      const body = Proxy.revocable(value, {});
      decrypted++;
      await visit(row, body.proxy);
      body.revoke();
    }
    return null;
  };
  expect(await exportBackup({ ...pins, scan }, { read: vi.fn(), missing }, output)).toEqual({ ok: true, data: { left: 0, skipped: 0 } });
  expect(decrypted).toBe(count);
  expect(written).toBeGreaterThan(1);
  expect(streamed).toBe(true);
});

it('aborts a stopped export without completing its destination', async () => {
  const target = destination();
  const abort = new AbortController();
  const source = store([persona('first', 1), persona('second', 2)]);
  const result = await exportBackup(source.api, { read: vi.fn(), missing }, target.output, {
    signal: abort.signal,
    progress: ({ kind, done }) => { if (kind === 'objects' && done === 1) abort.abort(); },
  });
  expect(result).toEqual({ ok: false, error: 'stopped' });
  expect(target.output.close).not.toHaveBeenCalled();
  expect(target.output.abort).toHaveBeenCalledOnce();
  expect(target.file().size).toBe(0);
});

it('saves files before their objects, leaves owners until last, and resumes after a stop', async () => {
  const source = await pictureObjects();
  const target = destination();
  await exportBackup(store(source.objects).api, { read: async () => ({ ok: true, data: source.bytes }), missing }, target.output);
  const opened = await backup(target.file());
  const next = store();
  const abort = new AbortController();
  let filesSaved = false;
  const batch = next.api.batch;
  next.api.batch = async (writes, progress) => {
    expect(filesSaved).toBe(true);
    return batch(writes, progress);
  };
  const save = async () => { filesSaved = true; return { ok: true as const, data: [source.ref] }; };
  expect(await restoreBackup(next.api, { save }, opened, {
    signal: abort.signal, progress: ({ kind, done }) => { if (kind === 'objects' && done === 1) abort.abort(); },
  })).toEqual({ ok: false, error: 'stopped' });
  expect(next.written).toEqual(['avatar']);
  expect(next.held.has('character')).toBe(false);
  expect(await restoreBackup(next.api, { save }, opened)).toEqual({ ok: true, data: { skipped: 0 } });
  expect(next.written).toEqual(['avatar', 'person', 'character']);
});

it('leaves out what names a picture the server refuses, and counts it', async () => {
  const source = await pictureObjects();
  const target = destination();
  await exportBackup(store(source.objects).api, { read: async () => ({ ok: true, data: source.bytes }), missing }, target.output);
  const next = store();
  expect(await restoreBackup(next.api, { save: async () => ({ ok: true, data: [null] }) }, await backup(target.file()))).toEqual({ ok: true, data: { skipped: 1 } });
  expect(next.written).toEqual(['person', 'character']);
});

it('reports a failing host call as a broken job, not a broken file', async () => {
  const source = await pictureObjects();
  const target = destination();
  await exportBackup(store(source.objects).api, { read: async () => ({ ok: true, data: source.bytes }), missing }, target.output);
  const save = async () => { throw new Error('Backup worker is closed'); };
  expect(await restoreBackup(store().api, { save }, await backup(target.file()))).toEqual({ ok: false, error: 'backup-crashed' });
});

it('exports without a picture the operator blocked and what names it, and counts them', async () => {
  const source = await pictureObjects();
  const target = destination();
  const read = async () => ({ ok: false as const, error: 'file-blocked' });
  const blocked = async (ids: string[]) => ({ ok: true as const, data: { missing: new Set(ids), maxBytes: 0, room: null } });
  expect(await exportBackup(store(source.objects).api, { read, missing: blocked }, target.output)).toEqual({ ok: true, data: { left: 0, skipped: 1 } });
  const opened = await backup(target.file());
  expect(opened.objects.map(({ id }) => id)).toEqual(['person', 'character']);
  expect(opened.files.size).toBe(0);
});

it('refuses a file with a body its kind cannot hold', async () => {
  const object = { ...persona('invalid', 1), value: { name: null, description: '', picture: null } };
  const file = new Blob([zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'risu-alpha-backup', version: 3 })),
    'objects.jsonl': strToU8(JSON.stringify(object)),
  })]);
  expect(await readBackup(file)).toEqual({ ok: false, error: 'not-backup' });
});

it('refuses a backup of an earlier version, apart from a damaged file', async () => {
  const file = new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'risu-alpha-backup', version: 2 })) })]);
  expect(await readBackup(file)).toEqual({ ok: false, error: 'other-version' });
});

it('reads pictures ahead in a bounded pool, past a slow one, and writes them in order', async () => {
  const source = await pictureObjects();
  const pictures = await Promise.all(Array.from({ length: 30 }, async (_, i) => {
    const bytes = new Uint8Array([i]);
    return { bytes, ref: (await sealFile(bytes)).ref };
  }));
  const character = source.objects.find(({ kind }) => kind === 'character')!;
  const assets = pictures.map(({ ref }, i): Stored<'asset'> => ({ id: `asset-${i}`, kind: 'asset', parent: character.id, rev: 10 + i, value: { file: ref, name: String(i), type: 'image/png', size: 1 } }));
  const target = destination();
  let inFlight = 0;
  let peak = 0;
  let slowDone = false;
  let pastSlow = false;
  const read = async (ref: FileRef) => {
    const at = pictures.findIndex((picture) => picture.ref.id === ref.id);
    peak = Math.max(peak, ++inFlight);
    if (at === 24) pastSlow = !slowDone;
    await new Promise((resolve) => setTimeout(resolve, at === 1 ? 30 : 1));
    if (at === 1) slowDone = true;
    inFlight--;
    return { ok: true as const, data: pictures[at]!.bytes };
  };
  expect(await exportBackup(store([character, ...assets]).api, { read, missing }, target.output)).toEqual({ ok: true, data: { left: 0, skipped: 0 } });
  expect(peak).toBe(24);
  expect(pastSlow).toBe(true);
  const opened = await backup(target.file());
  expect([...opened.files.keys()]).toEqual(pictures.map(({ ref }) => ref.id));
});

it('restores pictures in bounded uploader windows before writing objects', async () => {
  const pictures = await Promise.all(Array.from({ length: 25 }, async (_, i) => {
    const bytes = new Uint8Array([i]);
    return { bytes, ref: (await sealFile(bytes)).ref };
  }));
  const objects = pictures.map(({ ref }, i): Stored<'asset'> => ({ id: `asset-${i}`, kind: 'asset', parent: 'character', rev: i, value: { file: ref, name: String(i), type: 'image/png', size: 1 } }));
  const file = new Blob([zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'risu-alpha-backup', version: 3 })),
    'objects.jsonl': strToU8(objects.map((object) => JSON.stringify(object)).join('\n')),
    ...Object.fromEntries(pictures.map(({ bytes, ref }) => [`files/${ref.id}`, bytes])),
  })]);
  const next = store();
  const windows: number[] = [];
  const save = async (bytes: Uint8Array<ArrayBuffer>[]) => {
    expect(next.written).toEqual([]);
    windows.push(bytes.length);
    return { ok: true as const, data: await Promise.all(bytes.map(async (item) => (await sealFile(item)).ref)) };
  };
  expect(await restoreBackup(next.api, { save }, await backup(file))).toEqual({ ok: true, data: { skipped: 0 } });
  expect(windows).toEqual([12, 12, 1]);
});

it('decodes JSONL once and replays staged depths in source order when resuming', async () => {
  const messages: Stored<'entry'>[] = Array.from({ length: 140 }, (_, i) => ({
    id: `message-${140 - i}`, kind: 'entry', parent: 'chat', rev: 1,
    value: { type: 'message', role: 'user', at: i, text: String(i), receipt: null },
  }));
  const chat: Stored<'chat'> = { id: 'chat', kind: 'chat', parent: null, rev: 2, value: { title: null, character: null, models: {} } };
  const objects = [...messages, chat, persona('person', 3)];
  const file = new Blob([zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'risu-alpha-backup', version: 3 })),
    'objects.jsonl': strToU8(objects.map((object) => JSON.stringify(object)).join('\n')),
  })]);
  const inflate = vi.spyOn(zip, 'unzipEntry');
  const opened = await backup(file);
  const next = store();
  const abort = new AbortController();
  const files = { save: async () => ({ ok: true as const, data: [] }) };
  expect(await restoreBackup(next.api, files, opened, {
    signal: abort.signal, progress: ({ kind, done }) => { if (kind === 'objects' && done === 128) abort.abort(); },
  })).toEqual({ ok: false, error: 'stopped' });
  expect(await restoreBackup(next.api, files, opened)).toEqual({ ok: true, data: { skipped: 0 } });
  expect(next.written).toEqual(objects.map(({ id }) => id));
  expect(inflate.mock.calls.filter(([, entry]) => entry.name === 'objects.jsonl')).toHaveLength(1);
  await opened.records.close();
  inflate.mockRestore();
});

it('captures trash exclusions after pin hydrates a fresh or rewound store', async () => {
  const removed = { ...persona('removed', 1), value: { ...persona('removed', 1).value, deleted: 1 } };
  let pinned = false;
  const source = store([removed]);
  source.api.pin = async () => { pinned = true; return { ok: true, data: PIN }; };
  source.api.list = ((kind: Kind) => pinned && kind === 'persona' ? [removed] : []) as ObjectStore['list'];
  const target = destination();
  expect(await exportBackup(source.api, { read: vi.fn(), missing }, target.output)).toEqual({ ok: true, data: { left: 0, skipped: 0 } });
  expect((await backup(target.file())).objects).toEqual([]);
});
