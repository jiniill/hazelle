import { describe, expect, it, vi } from 'vitest';
import { blankCard } from '../engine/import/card';
import type { Original } from '../model/library';
import { sealFile } from '../vault/files';
import { api } from './api';
import { serverBackend } from './backend';
import { importCharacter, setDeleted } from './characters';
import { Files } from './files';
import { keepOriginal } from './originals';
import { purgeNow } from './removal';
import type { ObjectStore } from './store';
import { png, testServer } from './testing';

const server = testServer();
vi.mock('./picture', () => ({ thumbnail: vi.fn(async () => 'data:thumb') }));

async function originals(store: ObjectStore, parent: string): Promise<Original[]> {
  const rows: Original[] = [];
  const walked = await store.pinned((pin) => store.walk(parent, 'original', (_, value) => void rows.push(value as Original), 0, pin));
  if (!walked.ok) throw new Error(walked.error);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

describe('keepOriginal', () => {
  it('keeps the pieces under what the file made, an asset piece as the asset’s own file, and counts the refused', async () => {
    const { store } = await server.account();
    const [smile, sad, over] = [png(), png(), png()];
    const refused = (await sealFile(over)).ref.id;
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => (args[0] === 'PUT' && args[1] === `files/${refused}` ? { ok: false as const, error: 'files-full' } : api<T>(...args))), store);
    const made = await importCharacter(store, files, { card: blankCard('루나'), lore: [], loreFolders: [], assets: [{ name: 'smile', read: async () => smile }] }, null, () => {});
    const id = made.ok ? made.data.id : '';
    const parts = [
      { path: 'zip/smile.png', read: async () => smile },
      { path: 'zip/sad.png', read: async () => sad },
      { path: 'zip/over.png', read: async () => over },
      { path: 'zip/damaged.png', read: async () => null },
    ];

    expect(await keepOriginal(store, files, id, { name: 'luna.charx', parts }, () => {})).toEqual({ ok: true, data: { unkept: 1 } });
    const kept = await originals(store, id);
    expect(kept.map(({ name, path, size }) => [name, path, size])).toEqual([['luna.charx', 'zip/sad.png', sad.length], ['luna.charx', 'zip/smile.png', smile.length]]);
    expect(kept[1]!.file).toEqual(store.children('asset', id)[0]!.value.file);
    expect(await files.read(kept[0]!.file)).toEqual({ ok: true, data: sad });

    await setDeleted(store, id, Date.now());
    expect(await purgeNow(store, { sweep: async () => {} } as unknown as Files, 'character', id, () => {})).toEqual({ ok: true, data: null });
    expect(await originals(store, id)).toEqual([]);
  });
});
