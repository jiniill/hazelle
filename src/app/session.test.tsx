import { act } from 'react';
import { serverBackend } from '../runtime/backend';
import { expect, it, vi } from 'vitest';
import type { ChatScope } from '../engine/render';
import type { Chat } from '../model/chat';
import { AccountFacts } from '../runtime/account';
import type { ApiResult, api } from '../runtime/api';
import { plainDisplay, ReadModels, type Opening, type ScreenChat } from '../runtime/read-model';
import type { Session } from '../runtime/session';
import { ObjectStore } from '../runtime/store';
import type { Turn } from '../runtime/talk';
import * as display from '../runtime/chat-context';
import { randomBytes } from '../vault/aead';
import { AssetUrls } from '../runtime/assets';
import { SessionProvider, useAssetUrl, useChatDisplay } from './session';
import { probeRoot } from './ui/probe';

const facts = new AccountFacts({ suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0 });

it('C: composer and panel re-renders skip display, while streaming recomputes without replacing unchanged rows', async () => {
  let rev = 0;
  const request: typeof api = async <T,>(method: string): Promise<ApiResult<T>> => ({ ok: true, data: (method === 'GET'
    ? { timeline: 't', changes: [], cursor: 0, more: false, limits: { items: 100, bytes: 1_000_000, body: 100_000 } }
    : { revs: [++rev], timeline: 't' }) as T });
  const store = await ObjectStore.open('test', randomBytes(32), serverBackend(request));
  const lease = store.retainChat('chat');
  await lease.ready;
  const chat: Chat = { title: null, character: null, models: {} };
  await store.create('chat', chat, { id: 'chat' });
  await store.create('entry', { type: 'message', role: 'user', text: '{{lastmessage}}', at: 0, receipt: null }, { parent: 'chat' });
  const read = new ReadModels(store);
  let turn: Turn | null = null;
  const listeners = new Set<() => void>();
  const talk = { snapshot: (id: string) => (turn?.chat === id ? turn : null), subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const illustrator = { snapshot: () => new Map(), subscribe: () => () => true };
  const session = { store, read, talk, illustrator, display: plainDisplay(store) } as unknown as Session;
  const opening: Opening = { chat, messages: [] };
  const screen = { width: 800, height: 600 } satisfies NonNullable<ChatScope['screen']>;
  let view: ScreenChat;
  function Probe({ composer, panel }: { composer: string; panel: boolean }) {
    view = useChatDisplay('chat', { ...opening }, { ...screen });
    void composer;
    void panel;
    return null;
  }
  const root = probeRoot();
  const render = (composer: string, panel: boolean) => root.render(<SessionProvider session={session} account={{ admin: false, localProviders: [], facts, guest: null, onLock() {}, onLogout: async () => null }}><Probe composer={composer} panel={panel} /></SessionProvider>);
  const displayed = vi.spyOn(display, 'evaluateChat');
  try {
    await act(() => render('', false));
    const initial = view!;
    displayed.mockClear();
    await act(() => render('typing', false));
    await act(() => render('typing', true));
    expect(view!).toBe(initial);
    expect(displayed).not.toHaveBeenCalled();
    turn = { chat: 'chat', said: null, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'one', reasoning: '' };
    await act(() => { for (const listener of listeners) listener(); });
    const first = view!;
    turn = { ...turn, text: 'one two' };
    await act(() => { for (const listener of listeners) listener(); });
    expect(displayed).toHaveBeenCalledTimes(2);
    expect(view!.display.texts[0]).toBe('one two');
    expect(view!.messages[0]).toBe(first.messages[0]);
    expect(view!.messages[1]).not.toBe(first.messages[1]);
    const streaming = view!;
    await act(() => render('more typing', false));
    expect(view!).toBe(streaming);
    expect(displayed).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
    read.close();
    lease.release();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

function mountedPictures() {
  const store = {
    get: (_kind: string, id: string) => ({ value: { type: 'image/png', file: { id, key: 'k' } } }),
    subscribe: () => () => {},
  } as unknown as ObjectStore;
  const read = vi.fn(async () => ({ ok: true as const, data: new Uint8Array(1) }));
  const assets = new AssetUrls(store, { read }, 0);
  const session = { store, assets } as Session;
  const root = probeRoot();
  const shown = new Map<string, string | undefined>();
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  function Row({ row, picture }: { row: string; picture: string }) {
    const url = useAssetUrl([picture]);
    shown.set(row, url('asset', picture));
    return null;
  }
  return {
    shown, revoke, read,
    render: (rows: [string, string][]) => act(() => root.render(
      <SessionProvider session={session} account={{ admin: false, localProviders: [], facts, guest: null, onLock() {}, onLogout: async () => null }}>
        {rows.map(([row, picture]) => <Row key={row} row={row} picture={picture} />)}
      </SessionProvider>,
    )),
    close: async () => {
      await act(() => root.unmount());
      assets.close();
      revoke.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}

it('releases only pictures whose mounted rows leave or stop using them with no inactive budget', async () => {
  const pictures = mountedPictures();
  try {
    await pictures.render([['earlier', 'a'], ['current', 'b']]);
    const a = pictures.shown.get('earlier');
    const b = pictures.shown.get('current');
    expect(a).toMatch(/^blob:/);
    expect(b).toMatch(/^blob:/);
    await pictures.render([['current', 'b']]);
    expect(pictures.revoke).toHaveBeenCalledExactlyOnceWith(a);
    expect(pictures.shown.get('current')).toBe(b);
    await pictures.render([['current', 'c']]);
    expect(pictures.revoke.mock.calls).toEqual([[a], [b]]);
    expect(pictures.shown.get('current')).toMatch(/^blob:/);
  } finally {
    await pictures.close();
  }
});

it('shares a picture until its last row leaves, holding replacement owners before releasing old ones', async () => {
  const pictures = mountedPictures();
  try {
    await pictures.render([['first', 'shared'], ['second', 'shared']]);
    const shared = pictures.shown.get('first');
    expect(shared).toMatch(/^blob:/);
    expect(pictures.shown.get('second')).toBe(shared);
    await pictures.render([['second', 'shared']]);
    expect(pictures.revoke).not.toHaveBeenCalled();
    await pictures.render([['replacement', 'shared']]);
    expect(pictures.shown.get('replacement')).toBe(shared);
    expect(pictures.revoke).not.toHaveBeenCalled();
    expect(pictures.read).toHaveBeenCalledTimes(1);
    await pictures.render([]);
    expect(pictures.revoke).toHaveBeenCalledExactlyOnceWith(shared);
  } finally {
    await pictures.close();
  }
});
