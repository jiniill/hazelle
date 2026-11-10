import { describe, expect, it, vi } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { holdAccount } from '../api';
import { exportCharacter } from './card-file';
import { importCharacter, setDeleted } from '../library/characters';
import { purgeNow } from '../library/removal';
import { openVersion, publishShare, writeShared } from './share';
import { agreeToShare, readShareLink, readShareState, shareLink } from './share-link';
import { png, testServer } from '../testing';
import type { Files } from '../files/files';

const server = testServer();
// The sweep a removal for good starts is runtime/files/files' to test.
const unswept = { sweep: async () => {} } as unknown as Files;
vi.mock('../files/picture', () => ({ thumbnail: vi.fn(async () => 'data:thumb') }));

const collected = () => {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  return { chunks, output: { write: async (chunk: Uint8Array<ArrayBuffer>) => void chunks.push(chunk), close: async () => {}, abort: async () => {} } };
};
const joined = async (chunks: Uint8Array<ArrayBuffer>[]) => new Uint8Array(await new Blob(chunks).arrayBuffer());

describe('a share link', () => {
  it('opens with its key, signed out, as the very charx 내보내기 writes, and a new version keeps the link', async () => {
    const { accountId, store, files } = await server.operator();
    const card = { ...blankCard('루나'), creator: 'jin', creatorNotes: '등대지기\n둘째 줄' };
    const made = await importCharacter(store, files, { card, lore: [], loreFolders: [], assets: [{ name: 'shell', read: async () => png() }], own: null }, { bytes: png(), type: 'image/png' }, () => {});
    const id = made.ok ? made.data.id : '';
    expect(await agreeToShare()).toEqual({ ok: true, data: undefined });
    const published = await publishShare(store, files, id, true);
    if (!published.ok) throw new Error(published.error);
    const { share, key } = published.data.share.value;
    const link = readShareLink(new URL(shareLink('https://hazelle.app', share, key)).pathname, `#${key}`);
    expect(link).toEqual({ id: share, key });

    const exported = collected();
    expect(await exportCharacter(store, files, id, exported.output, () => {})).toEqual({ ok: true, data: { tools: 0 } });

    // The page holds no account, as signed out.
    holdAccount(null);
    const state = await readShareState(share);
    if (!state.ok || state.data.state !== 'live') throw new Error('not live');
    const opened = await openVersion({ id: share, operator: false }, state.data.manifest, key);
    if (!opened.ok) throw new Error(opened.error);
    expect({ ...opened.data.preview, avatar: opened.data.preview.avatar?.type }).toEqual({ name: '루나', creator: 'jin', notes: '등대지기\n둘째 줄', avatar: 'image/png' });
    expect((await openVersion({ id: share, operator: false }, state.data.manifest, key.replace(/^./, (char) => (char === 'A' ? 'B' : 'A')))).ok).toBe(false);

    const shared = collected();
    expect(await writeShared({ id: share, operator: false }, opened.data.content, shared.output, () => {})).toEqual({ ok: true, data: null });
    expect(await joined(shared.chunks)).toEqual(await joined(exported.chunks));

    holdAccount(accountId);
    const again = await publishShare(store, files, id, false);
    expect(again.ok && [again.data.share.value.share, again.data.version]).toEqual([share, 2]);
    expect(store.list('share')).toHaveLength(1);
  });

  it('stays live while its character is in 휴지통 and is cut when the character is removed for good', async () => {
    const { accountId, store, files } = await server.operator();
    const made = await importCharacter(store, files, { card: blankCard('루나'), lore: [], loreFolders: [], assets: [], own: null }, { bytes: png(), type: 'image/png' }, () => {});
    const id = made.ok ? made.data.id : '';
    await agreeToShare();
    const published = await publishShare(store, files, id, false);
    if (!published.ok) throw new Error(published.error);
    const { share } = published.data.share.value;
    await setDeleted(store, id, Date.now());
    holdAccount(null);
    expect(await readShareState(share)).toMatchObject({ ok: true, data: { state: 'live' } });

    holdAccount(accountId);
    expect(await purgeNow(store, unswept, 'character', id, () => {})).toEqual({ ok: true, data: null });
    holdAccount(null);
    expect(await readShareState(share)).toEqual({ ok: true, data: { state: 'gone' } });
    expect(store.list('share')).toHaveLength(0);
  });
});
