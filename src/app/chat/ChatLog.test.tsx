import { act, Fragment, isValidElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { pictureSizes } from '../../engine/illustrate';
import { shown, type Message, type Receipt } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import { withTurn, type Shown, type Turn } from '../../runtime/chat/talk';
import { probeRoot } from '../ui/probe';
import { ChatLog } from './ChatLog';
import { rowPart } from './rowPart';
import type { OpenChat } from './useChat';

type Split = { icon?: unknown; label: string; actions?: { label: string; onClick: () => void }[] };
const rendered = vi.fn<(props: { id: string }) => null>(() => null);
const divided = vi.fn<(props: Split) => null>(() => null);
const live = vi.hoisted(() => ({ origin: null as { title: string } | null, edits: { forgetOrigin: vi.fn() } }));
vi.mock('../session', () => ({ useChatSummary: () => live.origin, useAssetUrl: () => () => undefined }));
vi.mock('./ChatEdits', () => ({ useChatEdits: () => live.edits }));
vi.mock('./useReveal', () => ({ useReveal: (_version: string, text: string) => ({ text, revealing: false }) }));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  StoryMessage: (props: { id: string }) => rendered(props),
  Divider: (props: Split) => divided(props),
  useWide: () => true,
  Viewport: ({ keys, children }: { keys: string[]; children: (index: number) => ReactNode }) => keys.map((key, index) => <Fragment key={key}>{children(index)}</Fragment>),
}));

afterEach(() => { vi.unstubAllGlobals(); });

const picture = { id: 'picture', value: { version: 'old', at: 1, scene: { paragraph: 0 } } } as Stored<'illustration'>;
const closed = { open: false, from: null };
const modelMenu = { read: () => closed, subscribe: () => () => {}, set: () => {} };
const messageTools: OpenChat['messageTools'] = [];
const lineage = vi.fn();
let translations = new Map<string, string>();
let status = 'HP 7';
let bookmarked = new Set<string>();
const plain = (text: string) => text;
const frame = (messages: OpenChat['messages'], item: OpenChat['item'] = null) => ({
  item, messages, texts: messages.map((message) => shown(message).text), keys: messages.map(({ id }) => id),
  names: { character: { name: 'Bot', image: null }, me: null, modelName: null },
  decor: { bot: true, css: '', buttons: 'inert' },
  agents: { pre: false, post: true }, features: { translate: true, illustrate: true, mascot: false }, translate: { original: false },
  translating: { live: translations, failed: new Map() }, awaited: () => false, flipped: new Set(), shownTranslation: plain,
  pictures: new Map([['old', [picture]]]), placed: new Map(), illustrating: new Map(), pictureSizes: pictureSizes({}),
  remarks: new Map(), polishing: new Map(), badges: new Map([['old', ['badge']]]), messageTools,
  hosted: (index: number) => index === 0 ? [{ id: 'status', script: 0, html: status, at: 'top', message: 0 }] : [],
  offered: () => [{ id: 'status', name: 'Status', marked: true }],
  bookmarked, states: [], busy: true, branching: false, editing: null, timePin: null, scroll: { seek: null }, modelMenu,
  actions: { watch: () => () => {}, copy: () => {}, lineage },
}) as unknown as OpenChat;

it('renders only changed rows through chunks and translation, including rebuilt feature values and illustrated history', async () => {
  const history: Message[] = [{ id: 'old', role: 'assistant', at: 1, selected: 0, versions: [{ id: 'old', seed: 'old', text: 'Before', at: 1, receipt: null, edited: false }] }];
  const turn: Turn = { chat: 'chat', said: null, reply: { id: 'new', message: null, replaces: null, continues: null }, text: 'Now', reasoning: '' };
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

it('marks the split with the origin as it is named now, its kept name once the origin is gone, an act that opens the map and one that forgets it', async () => {
  const messages: Shown[] = [{ id: 'u1', role: 'user', at: 1, selected: 0, live: null, versions: [{ id: 'u1', seed: 'u1', text: 'Hi', at: 1, receipt: null, edited: false }] }];
  const item = { id: 'branch', chat: { title: null, character: null, models: {}, origin: { id: 'a', name: '그때 이름', after: 'u1' } } } as OpenChat['item'];
  const split = () => divided.mock.calls.map(([props]) => props).findLast((props) => props.icon)!;
  const labels = () => split().actions!.map(({ label }) => label);
  live.origin = { title: '지금 이름' };
  const root = probeRoot();
  try {
    await act(() => root.render(<ChatLog chat={frame(messages, item)} />));
    expect(split().label).toBe("'지금 이름'에서 분기됨");
    expect(labels()).toEqual(['원본 보기', '분기 지도', '원본 연결 끊기']);
    split().actions![1]!.onClick();
    expect(lineage).toHaveBeenCalled();
    split().actions![2]!.onClick();
    expect(live.edits.forgetOrigin).toHaveBeenCalledWith('branch');
    live.origin = null;
    await act(() => root.render(<ChatLog chat={frame(messages, item)} />));
    expect(split().label).toBe("삭제된 채팅 '그때 이름'에서 분기됨");
    expect(labels()).toEqual(['분기 지도', '원본 연결 끊기']);
  } finally {
    await act(() => root.unmount());
  }
});

// Every name a message's row gives its controls: labels, and words a button holds.
const names = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(names);
  if (isValidElement(node)) return Object.entries(node.props as Record<string, unknown>).flatMap(([key, value]) => (key === 'label' || key === 'children') && typeof value === 'string' ? [value] : names(value));
  if (node && typeof node === 'object' && 'label' in node && typeof node.label === 'string') return [node.label];
  return [];
};

it('names each act on a reply once: 다시 시도 on a failed one, and → apart from ⟳ on the last version', async () => {
  const failed = { state: 'failed', error: { kind: 'offline' } } as Receipt;
  const version = (id: string, receipt: Receipt | null) => ({ id, seed: id, text: receipt ? '' : id, at: 1, receipt, edited: false });
  const messages: Shown[] = [
    { id: 'u1', role: 'user', at: 1, selected: 0, live: null, versions: [version('u1', null)] },
    { id: 'a1', role: 'assistant', at: 1, selected: 1, live: null, versions: [version('v1', null), version('v2', null)] },
    { id: 'u2', role: 'user', at: 1, selected: 0, live: null, versions: [version('u2', null)] },
    { id: 'a2', role: 'assistant', at: 1, selected: 0, live: null, versions: [version('v3', failed)] },
  ];
  const row = (id: string) => rendered.mock.calls.map(([props]) => props as { id: string; tools: ReactNode; after: ReactNode; children: ReactNode }).findLast((props) => props.id === id)!;
  const named = (id: string) => [row(id).tools, row(id).after, row(id).children].flatMap(names);
  const root = probeRoot();
  try {
    await act(() => root.render(<ChatLog chat={{ ...frame(messages), busy: false }} />));
    expect(named('a2').filter((name) => name === '다시 시도')).toHaveLength(1);
    expect(named('a1')).toEqual(expect.arrayContaining(['다시 생성', '새 버전']));
  } finally {
    await act(() => root.unmount());
  }
});
