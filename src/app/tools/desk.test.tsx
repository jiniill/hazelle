import { act } from 'react';
import { expect, it } from 'vitest';
import type { Session } from '../../runtime/session';
import { probeRoot } from '../ui/probe';
import { toolDesk } from './desk';

const useDesk = toolDesk({ text: '', count: 0 });
let desk: ReturnType<typeof useDesk>;
function Probe({ session }: { session: Session }) {
  desk = useDesk(session);
  return null;
}

it('keeps a page state past the page, for its session only', () => {
  const session = {} as Session;
  const root = probeRoot();
  act(() => root.render(<Probe session={session} />));
  act(() => desk[1]({ text: '원문' }));
  act(() => desk[1]({ count: 2 }));
  act(() => root.unmount());

  const again = probeRoot();
  act(() => again.render(<Probe session={session} />));
  expect(desk[0]).toEqual({ text: '원문', count: 2 });
  act(() => again.render(<Probe session={{} as Session} />));
  expect(desk[0]).toEqual({ text: '', count: 0 });
  act(() => again.unmount());
});
