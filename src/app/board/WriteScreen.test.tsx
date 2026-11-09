import { act, type ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { WriteScreen } from './WriteScreen';

type Shown = { onSubmit?: unknown; actions: ReactElement<{ onClick: () => void; disabled: boolean }>; children: ReactElement<{ label?: string; hint?: string; value?: string; onChange?: (text: string) => void }>[] };
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

it('says by 내용 why an untouched 버그 template cannot be posted', () => {
  const root = probeRoot();
  act(() => root.render(<WriteScreen editing={null} operator={false} category="bug" back={null as never} />));
  const field = () => live.screen!.children.find((child) => child?.props?.label === '내용')!.props;
  const template = field().value!;
  act(() => field().onChange!(`${template}1. 눌렀어요`));
  const counting = field().hint;
  act(() => field().onChange!(template));
  expect(live.screen!.actions.props.disabled).toBe(true);
  expect(field().hint).not.toBe(counting);
  act(() => root.unmount());
});
