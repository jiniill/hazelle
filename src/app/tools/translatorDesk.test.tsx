import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from '../../runtime/session';
import { probeRoot } from '../ui/probe';
import { useTranslatorDesk } from './translatorDesk';

afterEach(() => {
  vi.unstubAllGlobals();
});

let desk: ReturnType<typeof useTranslatorDesk>;
function Probe({ session }: { session: Session }) {
  desk = useTranslatorDesk(session);
  return null;
}

it('keeps the text and the result past the page, for its session only', () => {
  const session = {} as Session;
  const root = probeRoot();
  act(() => root.render(<Probe session={session} />));
  act(() => desk.setSource('원문'));
  act(() => desk.setRun({ kind: 'done', text: 'translation', cut: false }));
  act(() => root.unmount());

  const again = probeRoot();
  act(() => again.render(<Probe session={session} />));
  expect(desk).toMatchObject({ source: '원문', run: { kind: 'done', text: 'translation' } });
  act(() => again.render(<Probe session={{} as Session} />));
  expect(desk).toMatchObject({ source: '', run: { kind: 'idle' } });
  act(() => again.unmount());
});
