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

it('asks for a request log entry anew on each press, so the entry already asked for opens again', async () => {
  let panels: ReturnType<typeof useChatPanels>;
  function Probe() {
    panels = useChatPanels('chat', 'chat', [], false, true, [], null);
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    await act(() => panels!.actions.openInspect('log', 'call'));
    const first = panels!.inspect;
    await act(() => panels!.actions.openInspect('log', 'call'));
    expect([first?.call?.id, panels!.inspect?.call?.id]).toEqual(['call', 'call']);
    expect(panels!.inspect?.call?.press).not.toBe(first?.call?.press);
  } finally {
    await act(() => root.unmount());
  }
});
