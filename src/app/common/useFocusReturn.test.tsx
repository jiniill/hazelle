import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useFocusReturn } from './useFocusReturn';

const element = () => ({ isConnected: true, focus: vi.fn() }) as unknown as HTMLElement & { focus: ReturnType<typeof vi.fn> };
const focus = (node: unknown) => Object.assign(document, { activeElement: node });

it('gives the focus back as what was open closes with it, to its button or else its opener, never over a moved focus', async () => {
  const root = probeRoot();
  let back: HTMLElement | null = null;
  function Probe({ open }: { open: boolean }) {
    useFocusReturn(open, () => back);
    return null;
  }
  const opener = element();
  const button = element();
  try {
    await act(async () => root.render(<Probe open={false} />));
    focus(opener);
    await act(async () => root.render(<Probe open />));
    focus(null);
    await act(async () => root.render(<Probe open={false} />));
    expect(opener.focus).toHaveBeenCalledOnce();

    back = button;
    await act(async () => root.render(<Probe open />));
    focus(null);
    await act(async () => root.render(<Probe open={false} />));
    expect(button.focus).toHaveBeenCalledOnce();

    await act(async () => root.render(<Probe open />));
    focus(element());
    await act(async () => root.render(<Probe open={false} />));
    expect(button.focus).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
