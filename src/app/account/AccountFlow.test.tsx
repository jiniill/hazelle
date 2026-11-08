import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionFacts } from '../../contracts/accounts';
import { randomBytes } from '../../vault/aead';
import { probeRoot } from '../ui/probe';
import type { Unlocked } from './AccountFlow';

const seen = vi.hoisted(() => ({
  failure: null as { message: string; onRetry: () => void } | null,
  choice: false,
  password: null as { mode: string; onBack?: () => void; onSignIn?: () => void; onDone: (username: string, password: string) => Promise<string | null> } | null,
  recovery: null as { username: string } | null,
  signIn: null as { username?: string; solo?: boolean; onGuest?: () => void } | null,
}));
vi.mock('./UnreachableScreen', () => ({ UnreachableScreen: (props: NonNullable<typeof seen.failure>) => { seen.failure = props; return null; } }));
vi.mock('./GuestDataScreen', () => ({ GuestDataScreen: () => { seen.choice = true; return null; } }));
vi.mock('./PasswordScreen', () => ({ PasswordScreen: (props: NonNullable<typeof seen.password>) => { seen.password = props; return null; } }));
vi.mock('./RecoveryKeyScreen', () => ({ RecoveryKeyScreen: (props: NonNullable<typeof seen.recovery>) => { seen.recovery = props; return null; } }));
vi.mock('./SignInScreen', () => ({ SignInScreen: (props: NonNullable<typeof seen.signIn>) => { seen.signIn = props; return null; } }));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  Screen: ({ children }: { children: ReactNode }) => children,
  Brand: () => null,
  Progress: () => null,
}));
vi.mock('../common/download', () => ({ clearDownloads: vi.fn(async () => {}) }));
vi.mock('../../runtime/account', async (original) => ({
  ...await original<typeof import('../../runtime/account')>(),
  loadSession: vi.fn(),
  uploadGuest: vi.fn(),
}));
vi.mock('../../runtime/guest-transfer', async (original) => ({
  ...await original<typeof import('../../runtime/guest-transfer')>(),
  guestWithContent: vi.fn(async () => ({ ok: true, data: null })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', { getItem: () => '', setItem: vi.fn() });
  seen.failure = null;
  seen.choice = false;
  seen.password = null;
  seen.recovery = null;
  seen.signIn = null;
});
afterEach(() => vi.unstubAllGlobals());

const waitFor = (check: () => void) => vi.waitFor(async () => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  check();
});

it.each([
  { name: 'risu-alpha', version: 1 },
  { name: 'risu-alpha-objects', version: 2 },
])('shows the close-other-tabs retry state for a blocked $name and opens normally after retry', async ({ name, version }) => {
  const old = await new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      if (name === 'risu-alpha') req.result.createObjectStore('device');
      else {
        req.result.createObjectStore('generations');
        req.result.createObjectStore('states');
        req.result.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  const { loadSession } = await import('../../runtime/account');
  vi.mocked(loadSession).mockResolvedValue({ ok: true, data: { session: null, door: { kind: 'open' } } });
  const { AccountFlow } = await import('./AccountFlow');
  const children = vi.fn<(account: Unlocked) => ReactNode>(() => null);
  const root = probeRoot();
  try {
    await act(() => root.render(<AccountFlow>{children}</AccountFlow>));
    await waitFor(() => expect(seen.failure).not.toBeNull());
    expect(seen.failure!.message).toBe('다른 탭에서 열어 둔 헤이젤을 닫고 다시 시도해 주세요.');
    expect(children).not.toHaveBeenCalled();
    old.close();
    await act(() => seen.failure!.onRetry());
    await waitFor(() => expect(children).toHaveBeenCalled());
    expect(children.mock.lastCall![0].guest).not.toBeNull();
    expect(loadSession).toHaveBeenCalledTimes(2);
  } finally {
    old.close();
    await act(() => root.unmount());
  }
});

it('shows the existing storage failure wording instead of staying on loading when startup rejects', async () => {
  const { loadSession } = await import('../../runtime/account');
  vi.mocked(loadSession).mockRejectedValue(new Error('Storage refused'));
  const { describeFailure } = await import('../common/failure');
  const { AccountFlow } = await import('./AccountFlow');
  const root = probeRoot();
  try {
    await act(() => root.render(<AccountFlow>{() => null}</AccountFlow>));
    expect(seen.failure?.message).toBe(describeFailure({ ok: false, error: 'browser-storage' }));
  } finally {
    await act(() => root.unmount());
  }
});

it('stops before remembering a guest vault when its head write fails, shows the failure, and retries', async () => {
  const { loadSession } = await import('../../runtime/account');
  vi.mocked(loadSession).mockResolvedValue({ ok: true, data: { session: null, door: { kind: 'open' } } });
  const device = await import('../../vault/device');
  const remember = vi.spyOn(device, 'rememberVault');
  const put = IDBObjectStore.prototype.put;
  const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'guest-heads') throw new DOMException('Browser full', 'QuotaExceededError');
    return put.call(this, value, key);
  });
  const { describeFailure } = await import('../common/failure');
  const { AccountFlow } = await import('./AccountFlow');
  const children = vi.fn<(account: Unlocked) => ReactNode>(() => null);
  const root = probeRoot();
  try {
    await act(() => root.render(<AccountFlow>{children}</AccountFlow>));
    await waitFor(() => expect(seen.failure).not.toBeNull());
    expect(seen.failure!.message).toBe(describeFailure({ ok: false, error: 'browser-storage' }));
    expect(children).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
    expect(await device.recallGuest()).toBeNull();
    write.mockRestore();
    await act(() => seen.failure!.onRetry());
    await waitFor(() => expect(children).toHaveBeenCalled());
    const { accountId, vaultKey } = children.mock.lastCall![0];
    expect(await device.recallGuest()).toEqual({ accountId, vaultKey });
  } finally {
    write.mockRestore();
    remember.mockRestore();
    await act(() => root.unmount());
  }
});

it('stops landing when guest content cannot be read and asks the guest-data question after a successful retry', async () => {
  const session: SessionFacts = { accountId: crypto.randomUUID(), username: 'tester', admin: false, suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0, localProviders: [] };
  const vaultKey = randomBytes(32);
  const device = await import('../../vault/device');
  await device.rememberVault(session.accountId, vaultKey);
  const remember = vi.spyOn(device, 'rememberVault');
  const { loadSession, uploadGuest } = await import('../../runtime/account');
  vi.mocked(loadSession).mockResolvedValue({ ok: true, data: { session, vault: { passwordWrap: '', recoveryWrap: '' } } });
  const { guestWithContent } = await import('../../runtime/guest-transfer');
  vi.mocked(guestWithContent).mockResolvedValueOnce({ ok: false, error: 'browser-storage' }).mockResolvedValueOnce({ ok: true, data: { accountId: crypto.randomUUID(), vaultKey } });
  const { describeFailure } = await import('../common/failure');
  const { AccountFlow } = await import('./AccountFlow');
  const children = vi.fn(() => null);
  const root = probeRoot();
  try {
    await act(() => root.render(<AccountFlow>{children}</AccountFlow>));
    await waitFor(() => expect(seen.failure).not.toBeNull());
    expect(seen.failure!.message).toBe(describeFailure({ ok: false, error: 'browser-storage' }));
    expect(children).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
    expect(uploadGuest).not.toHaveBeenCalled();
    expect(seen.choice).toBe(false);
    await act(() => seen.failure!.onRetry());
    await waitFor(() => expect(seen.choice).toBe(true));
    expect(children).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    remember.mockRestore();
  }
});

it("asks a one-person installation's first visitor for a password alone, and names the account itself", async () => {
  const { loadSession } = await import('../../runtime/account');
  vi.mocked(loadSession).mockResolvedValue({ ok: true, data: { session: null, door: { kind: 'setup' } } });
  const { AccountFlow } = await import('./AccountFlow');
  const children = vi.fn(() => null);
  const root = probeRoot();
  try {
    await act(() => root.render(<AccountFlow>{children}</AccountFlow>));
    await waitFor(() => expect(seen.password).not.toBeNull());
    expect(seen.password).toMatchObject({ mode: 'setup', onBack: undefined, onSignIn: undefined });
    expect(children).not.toHaveBeenCalled();
    await act(async () => { await seen.password!.onDone('', 'correct horse battery'); });
    await waitFor(() => expect(seen.recovery).toMatchObject({ username: '사용자' }));
  } finally {
    await act(() => root.unmount());
  }
});

it("signs in to a one-person installation's account by its password alone, with no guest to fall back to", async () => {
  const { loadSession } = await import('../../runtime/account');
  vi.mocked(loadSession).mockResolvedValue({ ok: true, data: { session: null, door: { kind: 'solo', username: 'jin' } } });
  const { AccountFlow } = await import('./AccountFlow');
  const root = probeRoot();
  try {
    await act(() => root.render(<AccountFlow>{() => null}</AccountFlow>));
    await waitFor(() => expect(seen.signIn).toMatchObject({ username: 'jin', solo: true, onGuest: undefined }));
  } finally {
    await act(() => root.unmount());
  }
});
