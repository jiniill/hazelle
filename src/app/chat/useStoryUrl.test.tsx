import { act } from 'react';
import { expect, it, vi } from 'vitest';
import type { PictureUrl } from '../../engine/assets';
import { AccountFacts } from '../../runtime/account/account';
import type { ApiResult } from '../../runtime/api';
import { AssetUrls } from '../../runtime/files/assets';
import type { Session } from '../../runtime/session';
import type { ObjectStore } from '../../runtime/store/store';
import { SessionProvider, type Account } from '../session';
import { Veil, VeilContext } from '../ui';
import { probeRoot } from '../ui/probe';
import { useStoryUrl } from './useStoryUrl';

const facts = new AccountFacts({ suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0 });
const account: Account = { admin: false, localProviders: [], proxy: false, facts, guest: null, onLock() {}, onLogout: async () => null };
const REF = 'asset:00000000-0000-4000-8000-000000000001';
const UNREAD = 'data:,#' + REF;

it('reads a picture under 이미지 가리기 only once it is tapped open, and lets it go when covered again', async () => {
  const store = { get: (_kind: string, id: string) => ({ value: { type: 'image/png', file: { id, key: 'k' } } }), subscribe: () => () => {} } as unknown as ObjectStore;
  const read = vi.fn(async (): Promise<ApiResult<Uint8Array<ArrayBuffer>>> => ({ ok: true, data: new Uint8Array(1) }));
  const assets = new AssetUrls(store, { read }, 0);
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const veil = new Veil();
  const root = probeRoot();
  let shown: string | undefined;
  function Row() {
    const url: PictureUrl = useStoryUrl([]);
    shown = url('asset', REF.slice('asset:'.length));
    return null;
  }
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve)));
  try {
    await act(() => root.render(<SessionProvider session={{ store, assets } as Session} account={account}><VeilContext value={veil}><Row /></VeilContext></SessionProvider>));
    await settle();
    expect([shown, read.mock.calls.length]).toEqual([UNREAD, 0]);
    await act(() => veil.open(REF));
    await settle();
    expect(shown).toMatch(/^blob:/);
    expect(shown!.endsWith('#' + REF)).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    // By the address it has now, as the story's 가리기 names it.
    await act(() => veil.cover(shown!));
    await settle();
    expect(shown).toBe(UNREAD);
    expect(revoke).toHaveBeenCalledOnce();
  } finally {
    await act(() => root.unmount());
    assets.close();
    revoke.mockRestore();
    vi.unstubAllGlobals();
  }
});
