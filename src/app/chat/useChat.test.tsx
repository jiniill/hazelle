import { act, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Display } from '../../engine/display';
import type { Card } from '../../engine/import/types';
import { illustratorPrompt } from '../../engine/illustrate';
import { translatorPrompt } from '../../engine/translate';
import type { Chat } from '../../model/chat';
import type { Character } from '../../model/library';
import { AccountFacts } from '../../runtime/account';
import type { api, ApiResult } from '../../runtime/api';
import { serverBackend } from '../../runtime/backend';
import { chatTranslate } from '../../runtime/features';
import { ReadModels } from '../../runtime/read-model';
import type { Session } from '../../runtime/session';
import { ObjectStore } from '../../runtime/store';
import { forecastSend } from '../../runtime/turn-context';
import { randomBytes } from '../../vault/aead';
import { SessionProvider } from '../session';
import { probeRoot } from '../ui/probe';
import { useChatIllustrations } from './useChatIllustrations';
import { useChatSettings } from './useChatSettings';
import { useChatStatus } from './useChatStatus';
import { useChatTranslation } from './useChatTranslation';
import { useSendNotes } from './useSendNotes';
import { changeSettings } from '../../runtime/account-settings';

vi.mock('../toast', () => ({ useToast: () => ({ settled: vi.fn(), show: vi.fn(), error: vi.fn(), undoable: vi.fn(), failed: vi.fn() }) }));
vi.mock('../../runtime/turn-context', async (original) => ({ ...(await original<typeof import('../../runtime/turn-context')>()), forecastSend: vi.fn(async () => null) }));

const facts = new AccountFacts({ suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0 });
const account = { admin: false, localProviders: [], facts, guest: null, onLock() {}, onLogout: async () => null };
const chat: Chat = { title: null, character: null, models: {} };
const VIEW: Display = { texts: [], css: '', drawn: [[0]], boxes: [], pass: false, unfound: [], stopped: null };
const TRANSLATING = { awaited: new Set(), live: new Map(), failed: new Map() };
const DRAWINGS = new Map();
const quiet = { snapshot: () => DRAWINGS, subscribe: () => () => true };
const card: Card = { name: 'Bot', nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false, bias: [], regex: [], triggers: [], loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } };
const prompt = { name: '대화', blocks: [], toggles: [], authorNote: '', models: {} };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function opened() {
  let rev = 0;
  const request: typeof api = async <T,>(method: string): Promise<ApiResult<T>> => ({ ok: true, data: (method === 'GET'
    ? { timeline: 't', changes: [], cursor: 0, more: false, limits: { items: 100, bytes: 1_000_000, body: 100_000 } }
    : { revs: [++rev], timeline: 't' }) as T });
  const store = await ObjectStore.open('test', randomBytes(32), serverBackend(request));
  const read = new ReadModels(store);
  const session = { store, read, translator: { snapshot: () => TRANSLATING, subscribe: () => () => true }, illustrator: quiet, memory: quiet } as unknown as Session;
  const root = probeRoot();
  vi.stubGlobal('window', Object.assign(window, { setTimeout, clearTimeout }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  return {
    store,
    render: (probe: ReactNode) => act(() => root.render(<SessionProvider session={session} account={account}>{probe}</SessionProvider>)),
    close: async () => {
      await act(() => root.unmount());
      read.close();
    },
  };
}

const settled = () => act(() => new Promise((resolve) => setTimeout(resolve, 450)));

it('renders the chat hooks for no unrelated write, while the forecast still runs again after one', async () => {
  const { store, render, close } = await opened();
  let renders = 0;
  const translate = chatTranslate(store, chat);
  function Probe() {
    renders += 1;
    const settings = useChatSettings('chat', chat, null);
    useChatStatus(settings.chat, null, VIEW, []);
    useChatTranslation('chat', settings.chat, [], [], translate);
    useChatIllustrations('chat', 'chat', settings.chat, []);
    useSendNotes('chat', null, settings.chat, [], null, '', false);
    return null;
  }
  try {
    await render(<Probe />);
    await settled();
    const forecasts = vi.mocked(forecastSend).mock.calls.length;
    const perWrite: number[] = [];
    for (const id of ['a', 'b', 'c']) {
      const at = renders;
      await act(() => store.create('chat', chat, { id }));
      perWrite.push(renders - at);
    }
    expect(perWrite).toEqual([0, 0, 0]);
    await settled();
    expect(vi.mocked(forecastSend).mock.calls.length).toBeGreaterThan(forecasts);
  } finally {
    await close();
  }
});

it("follows the chat's model, prompt and persona as they are written", async () => {
  const { store, render, close } = await opened();
  let settings: ReturnType<typeof useChatSettings>;
  function Probe() {
    settings = useChatSettings('chat', chat, null);
    return null;
  }
  try {
    await render(<Probe />);
    expect(settings!.prompt.kind).toBe('missing');
    await act(async () => {
      await store.create('prompt', prompt, { id: 'p' });
      await changeSettings(store, (current) => ({ ...current, prompt: 'p' }));
    });
    expect(settings!.prompt).toMatchObject({ kind: 'prompt', prompt: { value: { name: '대화' } } });
    await act(() => store.update('prompt', 'p', (current) => ({ ...current, name: '바뀐 대화' })));
    expect(settings!.prompt).toMatchObject({ kind: 'prompt', prompt: { value: { name: '바뀐 대화' } } });
  } finally {
    await close();
  }
});

it("names a status script by its module's name as the module is renamed", async () => {
  const { store, render, close } = await opened();
  let name: string | undefined;
  const bot = { card, folder: null, loreFolders: [] } as unknown as Character;
  function Probe() {
    name = useChatStatus(chat, bot, VIEW, []).offered(0)[0]?.name;
    return null;
  }
  try {
    await act(async () => {
      await store.create('module', { name: '종', description: '', namespace: null, regex: [{ id: 'r', name: '상태', find: 'a', replace: 'b', stage: 'display', flags: null }], triggers: [], toggles: [], loreFolders: [] }, { id: 'm' });
      await changeSettings(store, (current) => ({ ...current, modules: ['m'] }));
    });
    await render(<Probe />);
    expect(name).toContain('종');
    await act(() => store.update('module', 'm', (current) => ({ ...current, name: '새 종' })));
    expect(name).toContain('새 종');
  } finally {
    await close();
  }
});

it('follows the translation and illustration prompts as they are written', async () => {
  const { store, render, close } = await opened();
  let translation: ReturnType<typeof useChatTranslation>;
  let illustration: ReturnType<typeof useChatIllustrations>;
  const translate = chatTranslate(store, chat);
  function Probe() {
    translation = useChatTranslation('chat', chat, [], [], translate);
    illustration = useChatIllustrations('chat', null, chat, []);
    return null;
  }
  try {
    await render(<Probe />);
    expect(translation!.translation).toMatchObject({ ok: false, failure: { kind: 'prompt-missing' } });
    expect(illustration!.sceneWriter).toMatchObject({ kind: 'prompt-missing' });
    await act(async () => {
      await store.create('prompt', translatorPrompt(), { id: 'tp' });
      await store.create('prompt', illustratorPrompt(), { id: 'ip' });
      await changeSettings(store, (current) => ({ ...current, translatePrompt: 'tp', illustratePrompt: 'ip' }));
    });
    expect(translation!.translation).not.toMatchObject({ ok: false, failure: { kind: 'prompt-missing' } });
    expect(illustration!.sceneWriter).not.toMatchObject({ kind: 'prompt-missing' });
  } finally {
    await close();
  }
});
