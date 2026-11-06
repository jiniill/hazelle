import { act, Profiler, useEffect, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Card } from '../../engine/import/types';
import type { Kind, Stored } from '../../model/kinds';
import type { AccountFacts } from '../../runtime/account';
import { ReadModels } from '../../runtime/read-model';
import type { Session } from '../../runtime/session';
import type { ChatModel } from '../../runtime/summary';
import type { ObjectStore } from '../../runtime/store';
import type { StoreChange } from '../../runtime/object-index';
import { SessionProvider, type Account } from '../session';
import { Page } from './Page';
import type { Route } from './routes';
import { navigate } from './router';
import { probeRoot } from '../ui/probe';

const seen = vi.hoisted(() => ({ chats: [] as string[], mounts: 0, unmounts: 0, prompts: [] as string[], missing: [] as string[] }));
vi.mock('./router', async (original) => ({ ...await original<typeof import('./router')>(), navigate: vi.fn() }));
vi.mock('../chat/ChatScreen', () => ({ ChatScreen: ({ id }: { id: string }) => {
  seen.chats.push(id);
  useEffect(() => { seen.mounts++; return () => { seen.unmounts++; }; }, []);
  return null;
} }));
vi.mock('../prompts/PromptScreen', () => ({ PromptScreen: ({ stored }: { stored: Stored<'prompt'> }) => { seen.prompts.push(stored.value.name); return null; } }));
vi.mock('../common/Missing', () => ({ Missing: ({ what }: { what: string }) => { seen.missing.push(what); return null; } }));
// The probe has no DOM to draw the loading screen into; a lazy screen resolves within the render's act.
vi.mock('../common/ScreenLoad', async () => {
  const { Suspense } = await import('react');
  return { ScreenLoad: ({ children }: { children: ReactNode }) => <Suspense fallback={null}>{children}</Suspense> };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  seen.chats = [];
  seen.mounts = 0;
  seen.unmounts = 0;
  seen.prompts = [];
  seen.missing = [];
});

const prompt = (id: string, name: string): Stored<'prompt'> => ({ id, kind: 'prompt', parent: null, rev: 1, value: { name, blocks: [], toggles: [], models: {}, authorNote: '' } });

function page(initial: Stored<Kind>[], guest = false) {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const items = new Map(initial.map((item) => [item.id, item]));
  const models = new Map<string, ChatModel>();
  const listeners = new Set<(changes: readonly StoreChange[]) => void>();
  const list = vi.fn((kind: Kind) => [...items.values()].filter((item) => item.kind === kind));
  const release = vi.fn();
  const retain = vi.fn(() => ({ release, ready: Promise.resolve(null) }));
  const store = {
    list,
    get: (kind: Kind, id: string) => items.get(id)?.kind === kind ? items.get(id)! : null,
    projections: { get: (id: string) => models.has(id) ? { model: models.get(id)! } : null },
    unreadable: () => 0,
    subscribe: (listener: (changes: readonly StoreChange[]) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    retainChat: retain,
    scopeState: (id: string) => models.has(id) ? 'loaded' : 'unloaded',
    scopeError: () => null,
  } as unknown as ObjectStore;
  const read = new ReadModels(store);
  const session = { store, read } as Session;
  const account: Account = { admin: false, localProviders: [], facts: {} as AccountFacts, ...(guest ? { guest: { signupOpen: true, onSignup() {}, onSignIn() {} } } : { guest: null, onLock() {}, onLogout: async () => null }) };
  const root = probeRoot();
  const commits = vi.fn();
  const closeLayer = () => {};
  list.mockClear();
  return {
    items, models, read, list, retain, release, commits,
    announce: (kind: Kind, id: string) => { for (const listener of listeners) listener([{ kind, id, parent: null }]); },
    render: (route: Route) => act(async () => root.render(<SessionProvider session={session} account={account}><Profiler id="page" onRender={commits}><Page route={route} closeLayer={closeLayer} onPaired={() => {}} /></Profiler></SessionProvider>)),
    close: async () => { await act(() => root.unmount()); read.close(); },
  };
}

it.each([
  { kind: 'board-activity' },
] satisfies Route[])('replaces the guest’s $kind URL with the board list', async (route) => {
  const p = page([], true);
  try {
    await p.render(route);
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'board', operator: false }, { replace: true });
  } finally {
    await p.close();
  }
});

it('replaces a guest’s account notices URL with the account screen', async () => {
  const p = page([], true);
  try {
    await p.render({ kind: 'notices' });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'account', section: null }, { replace: true });
  } finally {
    await p.close();
  }
});

it('subscribes only to the routed item and follows its deleted, purging and restored states', async () => {
  const p = page([prompt('p', '선택한 프롬프트'), prompt('q', '다른 프롬프트')]);
  try {
    await p.render({ kind: 'prompt', id: 'p', pane: null });
    expect(seen.prompts).toEqual(['선택한 프롬프트']);
    expect(p.list).not.toHaveBeenCalled();
    p.commits.mockClear();
    await act(() => {
      p.items.set('q', prompt('q', '다른 곳에서 변경'));
      p.announce('prompt', 'q');
      p.announce('persona', 'unrelated');
    });
    expect(seen.prompts).toEqual(['선택한 프롬프트']);
    expect(p.commits).not.toHaveBeenCalled();
    expect(p.list).not.toHaveBeenCalled();

    await act(() => { p.items.set('p', prompt('p', '바꾼 이름')); p.announce('prompt', 'p'); });
    expect(seen.prompts).toEqual(['선택한 프롬프트', '바꾼 이름']);
    const deleted = prompt('p', '바꾼 이름');
    deleted.value.deleted = 1;
    await act(() => { p.items.set('p', deleted); p.announce('prompt', 'p'); });
    expect(seen.missing.at(-1)).toBe('deleted-prompt');
    await act(() => { p.items.set('p', { ...deleted, value: { ...deleted.value, purging: true } }); p.announce('prompt', 'p'); });
    expect(seen.missing.at(-1)).toBe('prompt');
    await act(() => { p.items.delete('p'); p.announce('prompt', 'p'); });
    expect(seen.missing.at(-1)).toBe('prompt');
    await act(() => { p.items.set('p', prompt('p', '되살린 프롬프트')); p.announce('prompt', 'p'); });
    expect(seen.prompts.at(-1)).toBe('되살린 프롬프트');
    expect(p.list).not.toHaveBeenCalled();
  } finally {
    await p.close();
  }
});

it('keeps the chat screen mounted through its first save, then distinguishes orphaned and deleted chats', async () => {
  const character: Stored<'character'> = { id: 'character', kind: 'character', parent: null, rev: 1, value: { card: { name: '주인공' } as Card, folder: null, loreFolders: [] } };
  const p = page([character]);
  try {
    await p.render({ kind: 'new-chat', character: character.id });
    const id = seen.chats.at(-1)!;
    expect(seen.mounts).toBe(1);
    const stored: Stored<'chat'> = { id, kind: 'chat', parent: null, rev: 2, value: { title: '첫 채팅', character: character.id, models: {} } };
    const model: ChatModel = { id, chat: stored.value, title: '첫 채팅', count: 0, preview: '', at: null, order: 2, messages: [], display: { texts: [], css: '', drawn: [], boxes: [], pass: false, unfound: [], stopped: null } };
    await act(() => { p.items.set(id, stored); p.models.set(id, model); p.announce('chat', id); });
    await p.render({ kind: 'chat', id });
    expect(seen.chats.at(-1)).toBe(id);
    expect(seen.mounts).toBe(1);
    expect(seen.unmounts).toBe(0);
    expect(p.retain).toHaveBeenCalledOnce();
    expect(p.release).not.toHaveBeenCalled();

    await act(() => { p.items.set(character.id, { ...character, value: { ...character.value, deleted: 1 } }); p.announce('character', character.id); });
    expect(seen.missing.at(-1)).toBe('orphaned-chat');
    await act(() => { p.items.set(id, { ...stored, value: { ...stored.value, deleted: 2 } }); p.announce('chat', id); });
    expect(seen.missing.at(-1)).toBe('chat');
    await act(() => { p.items.set(character.id, character); p.announce('character', character.id); });
    expect(seen.missing.at(-1)).toBe('deleted-chat');
    await p.render({ kind: 'prompt', id: 'not-here', pane: null });
    await p.render({ kind: 'new-chat', character: character.id });
    expect(seen.chats.at(-1)).not.toBe(id);
  } finally {
    await p.close();
  }
});
