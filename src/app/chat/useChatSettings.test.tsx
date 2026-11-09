import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Chat } from '../../model/chat';
import type { ApiFailure, ApiResult } from '../../runtime/api';
import type { Stored } from '../../model/kinds';
import { probeRoot } from '../ui/probe';
import { useChatSettings } from './useChatSettings';

let stored: Chat;
const store = {
  get: () => null,
  update: vi.fn(async (_kind: string, id: string, change: (current: Chat) => Chat): Promise<ApiResult<Stored<'chat'>>> => {
    stored = change(stored);
    return { ok: true, data: { kind: 'chat', id, parent: null, rev: 1, value: stored } };
  }),
  upsert: vi.fn(async () => ({ ok: true })),
};
vi.mock('../session', () => ({ useSession: () => ({ store }), useCaptured: (read: (reader: typeof store) => unknown) => read(store) }));
vi.mock('../toast', () => ({ useToast: () => ({ failed: vi.fn(), settled: vi.fn() }) }));

beforeEach(() => {
  stored = { title: 'Saved', character: 'owner', models: {} };
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('keeps unsaved choices for the first save, then patches the latest stored chat without replacing other settings', async () => {
  let settings: ReturnType<typeof useChatSettings>;
  function Probe({ saved }: { saved: Chat | null }) {
    settings = useChatSettings(saved ? 'chat' : null, saved, 'owner');
    return null;
  }
  const root = probeRoot();
  const model = { connection: 'connection', model: 'main' };
  try {
    await act(() => root.render(<Probe saved={null} />));
    await act(async () => {
      settings!.actions.pickModel(model);
      settings!.actions.setCast(['owner', 'guest', 'guest']);
      await settings!.actions.setPrompt('prompt');
      await settings!.actions.setNote('');
    });
    expect(store.update).not.toHaveBeenCalled();
    expect(settings!.chat).toEqual({ title: null, character: 'owner', models: { main: model }, cast: ['guest'], prompt: 'prompt', note: '' });
    await act(async () => {
      await settings!.actions.setPrompt(null);
      await settings!.actions.setNote(null);
    });
    expect(settings!.chat).not.toHaveProperty('prompt');
    expect(settings!.chat).not.toHaveProperty('note');

    stored = { ...settings!.chat, title: 'Saved' };
    await act(() => root.render(<Probe saved={stored} />));
    // A remote change after this render must survive the next local setting change.
    stored = { ...stored, note: 'From another device', models: { ...stored.models, aux: { connection: 'connection', model: 'aux' } } };
    await act(() => settings!.actions.pickModel({ ...model, model: 'next' }));
    expect(stored).toMatchObject({ note: 'From another device', models: { main: { model: 'next' }, aux: { model: 'aux' } }, cast: ['guest'] });
    await act(() => root.render(<Probe saved={stored} />));
    expect(settings!.chat).toBe(stored);
  } finally {
    await act(() => root.unmount());
  }
});

it('changes the current persona only after the saved chat accepts its persona', async () => {
  let settings: ReturnType<typeof useChatSettings>;
  function Probe() {
    settings = useChatSettings('chat', stored, 'owner');
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    const failure: ApiFailure = { ok: false, error: 'gone' };
    store.update.mockResolvedValueOnce(failure);
    await act(async () => expect(await settings!.actions.choosePersona('persona')).toBe(failure));
    expect(store.upsert).not.toHaveBeenCalled();
    expect(stored.persona).toBeUndefined();
    await act(async () => expect(await settings!.actions.choosePersona('persona')).toMatchObject({ ok: true }));
    expect(stored.persona).toBe('persona');
    expect(store.upsert).toHaveBeenCalledTimes(1);
    expect(store.upsert.mock.invocationCallOrder[0]!).toBeGreaterThan(store.update.mock.invocationCallOrder[1]!);
  } finally {
    await act(() => root.unmount());
  }
});

it('starts a new chat from its 시작 전 설문 answers, the last given in place of the earlier', async () => {
  let settings: ReturnType<typeof useChatSettings>;
  function Probe() {
    settings = useChatSettings(null, null, 'owner');
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    await act(async () => settings!.actions.startWith([['lang', 'en']]));
    await act(async () => settings!.actions.startWith([['lang', 'ko'], ['mode', 'easy']]));
    expect(settings!.chat.variables).toEqual([['lang', 'ko'], ['mode', 'easy']]);
    expect(store.update).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
  }
});
