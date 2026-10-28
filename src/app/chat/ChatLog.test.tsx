import { act, Fragment, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { pictureSizes } from '../../engine/illustrate';
import { shown, type Message } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import { withTurn, type Turn } from '../../runtime/talk';
import { probeRoot } from '../ui/probe';
import { ChatLog } from './ChatLog';
import { rowPart } from './rowPart';
import type { OpenChat } from './useChat';

const rendered = vi.fn<(props: { id: string }) => null>(() => null);
vi.mock('../session', () => ({ useChatSummary: () => null, useAssetUrl: () => () => undefined }));
vi.mock('./useReveal', () => ({ useReveal: (_version: string, text: string) => ({ text, revealing: false }) }));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  StoryMessage: (props: { id: string }) => rendered(props),
  Divider: () => null,
  useWide: () => true,
  Viewport: ({ keys, children }: { keys: string[]; children: (index: number) => ReactNode }) => keys.map((key, index) => <Fragment key={key}>{children(index)}</Fragment>),
}));

afterEach(() => { vi.unstubAllGlobals(); });

it('renders only changed rows through chunks and translation, including rebuilt feature values and illustrated history', async () => {
  const history: Message[] = [{ id: 'old', role: 'assistant', at: 1, selected: 0, versions: [{ id: 'old', seed: 'old', text: 'Before', at: 1, receipt: null, edited: false }] }];
  const turn: Turn = { chat: 'chat', said: null, reply: { id: 'new', message: null, replaces: null, continues: null }, text: 'Now', reasoning: '' };
  const picture = { id: 'picture', value: { version: 'old', at: 1, scene: { paragraph: 0 } } } as Stored<'illustration'>;
  const closed = { open: false, from: null };
  const modelMenu = { read: () => closed, subscribe: () => () => {}, set: () => {} };
  const messageTools: OpenChat['messageTools'] = [];
  let translations = new Map<string, string>();
  let status = 'HP 7';
  let bookmarked = new Set<string>();
  const frame = (messages: OpenChat['messages']) => ({
    item: null, messages, texts: messages.map((message) => shown(message).text), keys: messages.map(({ id }) => id),
    names: { character: { name: 'Bot', image: null }, me: null, modelName: null },
    decor: { bot: true, css: '', buttons: 'inert' },
    agents: { pre: false, post: true }, features: { translate: true, illustrate: true, mascot: false }, translate: { original: false },
    translating: { live: translations, failed: new Map() }, awaited: () => false, flipped: new Set(),
    pictures: new Map([['old', [picture]]]), placed: new Map(), illustrating: new Map(), pictureSizes: pictureSizes({}),
    remarks: new Map(), polishing: new Map(), badges: new Map([['old', ['badge']]]), messageTools,
    hosted: (index: number) => index === 0 ? [{ id: 'status', script: 0, html: status, at: 'top', message: 0 }] : [],
    offered: () => [{ id: 'status', name: 'Status', marked: true }],
    bookmarked, busy: true, branching: false, editing: null, timePin: null, scroll: { seek: null }, modelMenu,
    actions: { watch: () => () => {}, copy: () => {} },
  }) as unknown as OpenChat;
  const counts = () => ['old', 'new'].map((id) => rendered.mock.calls.filter(([props]) => props.id === id).length);
  const root = probeRoot();
  try {
    await act(() => root.render(<ChatLog chat={frame(withTurn(history, turn, 'chat'))} />));
    expect(counts()).toEqual([1, 1]);
    const chunk = withTurn(history, { ...turn, text: 'Now more' }, 'chat');
    await act(() => root.render(<ChatLog chat={frame(chunk)} />));
    expect(counts()).toEqual([1, 2]);
    translations = new Map([['new', '지금']]);
    await act(() => root.render(<ChatLog chat={frame(chunk)} />));
    expect(counts()).toEqual([1, 3]);
    status = 'HP 6';
    await act(() => root.render(<ChatLog chat={frame(chunk)} />));
    expect(counts()).toEqual([2, 3]);
    bookmarked = new Set(['old']);
    await act(() => root.render(<ChatLog chat={frame(chunk)} />));
    expect(counts()).toEqual([3, 3]);
    await act(() => root.render(<ChatLog chat={frame(chunk)} />));
    expect(counts()).toEqual([3, 3]);
  } finally {
    await act(() => root.unmount());
  }

  // @ts-expect-error A new structured row field must declare its equality rule at its producer.
  rowPart({ feature: { enabled: true } }, {});
});
