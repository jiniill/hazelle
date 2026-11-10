import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Chat } from '../../model/chat';
import { translateSwitches } from '../../runtime/library/characters';
import type { Drawing } from '../../runtime/tasks/illustrate';
import { pickVersion } from '../../runtime/chat/message-acts';
import type { Shown } from '../../runtime/chat/talk';
import { probeRoot } from '../ui/probe';
import { useChatBookmarks } from './useChatBookmarks';
import { useChatIllustrations } from './useChatIllustrations';
import { useChatSearch } from './useChatSearch';
import { useChatTranslation } from './useChatTranslation';

const session = { store: { get: () => null }, illustrator: { draw: vi.fn() } };
const toast = { error: vi.fn(), show: vi.fn() };
let drawings: ReadonlyMap<string, Drawing> = new Map();
const translating = { live: new Map<string, string>(), failed: new Map() };
const pictures: [] = [];
vi.mock('../session', () => ({
  useSession: () => session,
  useCaptured: (read: (store: typeof session.store) => unknown) => read(session.store),
  useChildren: () => pictures,
  useIllustrating: () => drawings,
  useTranslating: () => translating,
}));
vi.mock('../toast', () => ({ useToast: () => toast }));
vi.mock('../../runtime/chat/message-acts', () => ({ pickVersion: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../runtime/tasks/translate', () => ({ translatorOf: () => ({ ok: false, failure: { kind: 'prompt-missing', own: false } }), translationShown: () => (text: string) => text }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  drawings = new Map();
});

const message = (id: string): Shown => ({
  id, role: 'assistant', at: 1, selected: 0, live: null,
  versions: [{ id: `${id}-version`, seed: id, text: 'Hello', receipt: null, edited: false, at: 1, translation: { text: '안녕', receipt: null, at: 1 } }],
});

it('seeks a bookmark on another branch only after the switched messages are displayed, and only once', async () => {
  let bookmarks: ReturnType<typeof useChatBookmarks>;
  const find = vi.fn();
  const parent = message('parent');
  const target = message('target');
  const row = { message: target, name: null, to: [{ message: parent, index: 1 }] };
  function Probe({ messages, busy = false }: { messages: Shown[]; busy?: boolean }) {
    bookmarks = useChatBookmarks('chat', [{ message: target.id }], messages, busy, find);
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe messages={[parent]} busy />));
    act(() => expect(bookmarks!.actions.showBookmark(row)).toBe(false));
    expect(pickVersion).not.toHaveBeenCalled();
    await act(() => root.render(<Probe messages={[parent]} />));
    await act(() => expect(bookmarks!.actions.showBookmark(row)).toBe(true));
    expect(pickVersion).toHaveBeenCalledWith(session, 'chat', parent, 1);
    expect(find).not.toHaveBeenCalled();
    await act(() => root.render(<Probe messages={[parent, target]} />));
    expect(find).toHaveBeenCalledExactlyOnceWith([target.id]);
    await act(() => root.render(<Probe messages={[parent, target]} />));
    expect(find).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
  }
});

it('searches the original when translation is flipped and keeps the choice per reply version', async () => {
  let translation: ReturnType<typeof useChatTranslation>;
  let search: ReturnType<typeof useChatSearch>;
  const first = message('first');
  const second = message('second');
  const messages = [first, second];
  const texts = messages.map(() => 'Hello');
  const chat: Chat = { title: null, character: null, models: {} };
  function Probe() {
    translation = useChatTranslation('chat', chat, messages, texts, translateSwitches(session.store, null));
    search = useChatSearch(messages, texts, translation.translating, translation.flipped, translation.shownTranslation, () => {}, null);
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    await act(() => search!.actions.openSearch());
    await act(() => search!.actions.searchFor('Hello'));
    expect(search!.search?.hits).toBe(0);
    await act(() => translation!.actions.flipTranslation(first));
    expect(search!.search?.hits).toBe(1);
    await act(() => search!.actions.searchFor('안녕'));
    expect(search!.search?.hits).toBe(1);
    await act(() => translation!.actions.flipTranslation(first));
    expect(search!.search?.hits).toBe(2);
  } finally {
    await act(() => root.unmount());
  }
});

it('keeps illustration failures acknowledged across reopening and does not draw an unsaved chat', async () => {
  const failed: Drawing = { chat: 'chat', version: 'version', writing: false, failure: { kind: 'no-image-model' }, sketches: [] };
  drawings = new Map([['message', failed]]);
  let illustration: ReturnType<typeof useChatIllustrations>;
  function Probe({ id }: { id: string | null }) {
    illustration = useChatIllustrations('chat', id, { title: null, character: null, models: {} }, []);
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe id={null} />));
    expect(illustration!.stage).toBe(true);
    illustration!.actions.draw('message', 'version');
    expect(session.illustrator.draw).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    await act(() => root.render(null));
    await act(() => root.render(<Probe id="chat" />));
    expect(toast.error).toHaveBeenCalledTimes(1);
    illustration!.actions.draw('message', 'version', null, true);
    expect(session.illustrator.draw).toHaveBeenCalledExactlyOnceWith('chat', 'message', 'version', { scene: null, spend: true });
  } finally {
    await act(() => root.unmount());
  }
});
