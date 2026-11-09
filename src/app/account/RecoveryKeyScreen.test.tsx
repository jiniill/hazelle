import { act, type ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { RecoveryKeyScreen } from './RecoveryKeyScreen';

type Shown = { actions: ReactElement<{ children: (ReactElement<{ disabled?: boolean }> | null | false)[] }>; children: ReactElement<{ label?: string; onClick?: () => void; onChange?: (checked: boolean) => void }>[] };
const live = vi.hoisted(() => ({ screen: null as Shown | null }));
vi.mock('../common/download', () => ({ download: vi.fn() }));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  Screen: (props: Shown) => {
    live.screen = props;
    return null;
  },
}));

it('says by 시작하기 why it waits, until the key file is exported and its saving ticked', () => {
  const root = probeRoot();
  act(() => root.render(<RecoveryKeyScreen username="jin" recoveryKey="key" saved={false} failure={null} onBack={() => {}} onStart={() => {}} />));
  const start = () => live.screen!.actions.props.children[0] as ReactElement<{ disabled?: boolean }>;
  const why = () => live.screen!.actions.props.children[1];
  act(() => live.screen!.children.find((child) => child?.props?.label === '안전한 곳에 저장했어요')!.props.onChange!(true));
  expect(start().props.disabled).toBe(true);
  expect(why()).toBeTruthy();
  act(() => live.screen!.children.find((child) => child?.props?.onClick)!.props.onClick!());
  expect(start().props.disabled).toBe(false);
  expect(why()).toBeFalsy();
  act(() => root.unmount());
});
