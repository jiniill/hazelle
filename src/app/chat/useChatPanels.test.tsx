import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useChatPanels } from './useChatPanels';

vi.mock('../session', () => ({ useToolFrames: () => new Map() }));
vi.mock('../ui', () => ({ usePanelsBeside: () => false }));

afterEach(() => {
  vi.unstubAllGlobals();
});

it('closes the 장기 기억 panel once memory is turned off, and leaves it closed when it is turned on again', async () => {
  let panels: ReturnType<typeof useChatPanels>;
  function Probe({ memory }: { memory: boolean }) {
    panels = useChatPanels('chat', 'chat', [], false, memory, [], null);
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe memory />));
    await act(() => panels!.actions.memory(null));
    expect(panels!.panel).toEqual({ kind: 'memory', record: null });
    await act(() => root.render(<Probe memory={false} />));
    expect(panels!.panel).toBeNull();
    await act(() => root.render(<Probe memory />));
    expect(panels!.panel).toBeNull();
  } finally {
    await act(() => root.unmount());
  }
});
