import { act, type FormEvent, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { WriteScreen } from './WriteScreen';

const live = vi.hoisted(() => ({ submit: null as ((event: FormEvent<HTMLFormElement>) => void) | null, gate: vi.fn() }));
vi.mock('../session', () => ({ useStanding: () => ({ suspended: false }), useSession: () => ({ username: 'u' }), useAccount: () => ({ admin: false, guest: false }) }));
vi.mock('../toast', () => ({ useToast: () => ({}) }));
vi.mock('./nickname', () => ({ useNicknameGate: () => ({ gate: live.gate, dialog: null }) }));
vi.mock('./pictures', () => ({ useDraftPictures: () => ({ items: [] }), DraftPictures: () => null }));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  Screen: ({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) => {
    live.submit = onSubmit;
    return null;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  live.gate.mockClear();
});

it('moves on to 내용 from Enter in 제목, and posts only from 올리기', () => {
  const root = probeRoot();
  act(() => root.render(<WriteScreen editing={{ id: 1, title: '제목', text: '내용', category: 'idea' } as never} operator={false} back={null as never} />));
  const title = { type: 'text' };
  const body = { type: 'textarea', focus: vi.fn() };
  const post = { type: 'submit' };
  const submitted = () => live.submit!({ preventDefault() {}, currentTarget: { elements: [title, body, post] } } as never);

  Object.assign(document, { activeElement: title });
  submitted();
  expect(body.focus).toHaveBeenCalledOnce();
  expect(live.gate).not.toHaveBeenCalled();

  Object.assign(document, { activeElement: post });
  submitted();
  expect(live.gate).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
