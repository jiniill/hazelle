import { act, type ReactElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { PasswordScreen, type Stop } from './PasswordScreen';

type Props = { label?: string; tone?: string; error?: string; action?: { label: string; onClick: () => void }; onChange?: (value: string) => void; children?: ReactNode };
const live = vi.hoisted(() => ({ screen: null as { onSubmit: (event: { preventDefault: () => void }) => void; children: ReactNode } | null }));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  Screen: (props: NonNullable<typeof live.screen>) => {
    live.screen = props;
    return null;
  },
}));

function find(node: ReactNode, match: (props: Props) => boolean): Props | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map((each) => find(each, match)).find(Boolean) ?? null;
  const { props } = node as ReactElement<Props>;
  return match(props) ? props : find(props.children, match);
}
const field = (label: string) => find(live.screen!.children, (props) => props.label === label)!;
const callout = () => find(live.screen!.children, (props) => props.tone === 'warn');

it('says a refused name on its field until the name changes, and offers 다시 시도 after a lost connection', async () => {
  const onDone = vi.fn<() => Promise<Stop | null>>().mockResolvedValueOnce({ username: '이미 쓰고 있는 아이디예요.' }).mockResolvedValueOnce({ retry: '서버에 연결하지 못했어요.' }).mockResolvedValue(null);
  const root = probeRoot();
  act(() => root.render(<PasswordScreen mode="signup" username="jin" password="correct horse" onDone={onDone} />));
  const submit = () => act(async () => live.screen!.onSubmit({ preventDefault() {} }));
  await submit();
  expect(field('아이디').error).toBe('이미 쓰고 있는 아이디예요.');
  expect(callout()).toBeNull();
  act(() => field('아이디').onChange!('jinny'));
  expect(field('아이디').error).toBeUndefined();
  await submit();
  expect(callout()!.action!.label).toBe('다시 시도');
  await act(async () => callout()!.action!.onClick());
  expect(onDone).toHaveBeenLastCalledWith('jinny', 'correct horse');
  expect(onDone).toHaveBeenCalledTimes(3);
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
