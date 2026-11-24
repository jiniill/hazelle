import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ChangeSignal } from '../../change-signal';
import { AccountFacts } from '../../runtime/account/account';
import { randomBytes } from '../../vault/aead';
import { probeRoot } from '../ui/probe';
import { Workspace } from './Workspace';

const { passing } = vi.hoisted(() => ({ passing: ({ children }: { children: unknown }) => children }));
let layouts = 0;
let standing: unknown[] = [];
let session: unknown;
vi.mock('../../runtime/session', () => ({ openSession: async () => ({ ok: true, data: session }) }));
vi.mock('../../runtime/device/drafts', () => ({ Drafts: class { persist = async () => {}; close = async () => {}; } }));
vi.mock('../../runtime/device/device-values', () => ({ carryDeviceValues: () => {} }));
vi.mock('../../runtime/diagnostics/auto-diagnosis', () => ({ notePlace: () => {}, noteStep: () => {} }));
vi.mock('../session', () => ({ SessionProvider: passing, useSession: () => session, useSaves: () => ({}), useHeldLeave: () => null, useSettings: () => ({}), useStore: () => ({}) }));
vi.mock('../display', () => ({ DisplayProvider: passing, useDisplay: () => ({ display: { chimes: false, chimeSounds: {} } }) }));
vi.mock('../common/Tutorial', () => ({ TutorialProvider: passing, useTutorials: () => ({}) }));
vi.mock('../common/Offer', () => ({ Offers: () => null }));
vi.mock('../library/ImportFlow', () => ({ ImportProvider: passing }));
vi.mock('./router', () => ({ useRoute: () => ({ kind: 'home' }), navigate: () => {} }));
vi.mock('./PasteReader', () => ({ PasteReader: () => null }));
vi.mock('./Arrivals', () => ({ Arrivals: () => null }));
vi.mock('./BotNotes', () => ({ BotNotes: () => null }));
vi.mock('./Layout', () => ({
  Layout: () => {
    layouts++;
    return null;
  },
}));
// The probe draws no elements, so the opening screen stands only in the server markup, where there is no window.
vi.mock('../ui', async (original) => {
  const ui = await original<typeof import('../ui')>();
  return {
    ...ui,
    Screen: (props: Parameters<typeof ui.Screen>[0]) => (typeof window === 'undefined' ? <ui.Screen {...props} /> : null),
    Toast: () => null,
    ToastStack: ({ items }: { items: { key: unknown; toast: { props: { message: string } } }[] }) => {
      standing = items.filter(({ key }) => key === 'standing').map(({ toast }) => toast.props.message);
      return null;
    },
  };
});

const facts = () => new AccountFacts({ suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0 });
const workspace = (held: AccountFacts) => <Workspace accountId="account" vaultKey={randomBytes(32)} username="jin" admin={false} localProviders={[]} proxy={false} guest={null} facts={held} onLock={() => {}} onLogout={async () => null} />;

it('shows the initial pull count before the session opens instead of a blank screen', () => {
  const html = renderToStaticMarkup(workspace(facts()));
  expect(html).toContain('불러오는 중');
});

it('puts up and takes down the standing notice without drawing the workspace again', async () => {
  const connection = new ChangeSignal();
  let waiting = false;
  const none = () => () => {};
  session = { store: { subscribeWaiting: connection.subscribe, waiting: () => waiting, subscribeRewound: none }, startBackground: () => {}, close: () => {}, talk: { subscribe: none }, transport: {}, cues: { subscribe: none } };
  const held = facts();
  const root = probeRoot();
  try {
    await act(async () => root.render(workspace(held)));
    expect(layouts).toBe(1);
    await act(() => {
      waiting = true;
      connection.notify();
    });
    expect(standing).toEqual(['연결이 불안정해요']);
    await act(() => held.heard({ kind: 'suspended' }));
    expect(standing).toEqual(['연결이 불안정해요']);
    await act(() => {
      waiting = false;
      connection.notify();
    });
    expect(standing).toEqual(['운영자가 이 계정을 정지했어요']);
    expect(layouts).toBe(1);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
