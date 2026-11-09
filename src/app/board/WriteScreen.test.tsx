import { act, type ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { WriteScreen } from './WriteScreen';

type Shown = { onSubmit?: unknown; actions: ReactElement<{ onClick: () => void }> };
const live = vi.hoisted(() => ({ screen: null as Shown | null, gate: vi.fn() }));
vi.mock('../session', () => ({ useStanding: () => ({ suspended: false }), useSession: () => ({ username: 'u' }), useAccount: () => ({ admin: false, guest: false }) }));
vi.mock('../toast', () => ({ useToast: () => ({}) }));
vi.mock('./nickname', () => ({ useNicknameGate: () => ({ gate: live.gate, dialog: null }) }));
vi.mock('./pictures', () => ({ useDraftPictures: () => ({ items: [] }), DraftPictures: () => null }));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  Screen: (props: Shown) => {
    live.screen = props;
    return null;
  },
}));

afterEach(() => live.gate.mockClear());

it('posts only from 올리기, never from Enter in 제목', () => {
  const root = probeRoot();
  act(() => root.render(<WriteScreen editing={{ id: 1, title: '제목', text: '내용', category: 'idea' } as never} operator={false} back={null as never} />));
  expect(live.screen!.onSubmit).toBeUndefined();
  live.screen!.actions.props.onClick();
  expect(live.gate).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
