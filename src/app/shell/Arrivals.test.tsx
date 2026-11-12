import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { blankCard } from '../../engine/import/card';
import type { api, ApiResult } from '../../runtime/api';
import { Cues } from '../../runtime/chat/cues';
import { serverBackend } from '../../runtime/store/backend';
import { ReadModels } from '../../runtime/store/read-model';
import { ObjectStore } from '../../runtime/store/store';
import { randomBytes } from '../../vault/aead';
import { probeRoot } from '../ui/probe';
import { Arrivals } from './Arrivals';
import { navigate } from './router';

const toast = { show: vi.fn(), error: vi.fn() };
let session: unknown;
vi.mock('../toast', () => ({ useToast: () => toast }));
vi.mock('../session', () => ({ useSession: () => session }));
vi.mock('./router', () => ({ useRoute: () => ({ kind: 'chat', id: 'open' }), navigate: vi.fn() }));

it('says a reply that ended in a chat not open, received or failed, with the way to it, and nothing of the open one', async () => {
  let rev = 0;
  const request: typeof api = async <T,>(method: string): Promise<ApiResult<T>> => ({ ok: true, data: (method === 'GET'
    ? { timeline: 't', changes: [], cursor: 0, more: false, limits: { items: 100, bytes: 1_000_000, body: 100_000 } }
    : { revs: [++rev], timeline: 't' }) as T });
  const store = await ObjectStore.open('test', randomBytes(32), serverBackend(request));
  const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  for (const id of ['open', 'away']) await store.create('chat', { title: null, character: character.data.id, models: {} }, { id });
  const cues = new Cues();
  session = { cues, store, read: new ReadModels(store) };
  const root = probeRoot();
  await act(() => root.render(<Arrivals />));

  cues.emit('reply-received', 'open');
  cues.emit('reply-started', 'away');
  cues.emit('translated', 'away');
  expect(toast.show).not.toHaveBeenCalled();
  cues.emit('reply-received', 'away');
  cues.emit('reply-failed', 'away');
  expect(toast.show).toHaveBeenCalledWith('루나 응답이 도착했어요', { action: expect.objectContaining({ label: '보기' }) });
  expect(toast.error).toHaveBeenCalledWith('루나 응답이 실패했어요', { action: expect.objectContaining({ label: '보기' }) });

  toast.show.mock.calls[0]![1].action.onClick();
  expect(navigate).toHaveBeenCalledWith({ kind: 'chat', id: 'away' });
  await act(() => root.unmount());
  store.close();
});
