import { act, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import type { PersonaChoice } from '../../runtime/library/personas';
import { probeRoot } from '../ui/probe';
import { PersonaDialog } from './ChatPersonaPicker';

const calls: string[] = [];
const footer = vi.fn<(props: { footer: ReactNode }) => ReactNode>(({ footer }) => footer);
const button = vi.fn<(props: { children: ReactNode; onClick: () => void }) => null>(() => null);
vi.mock('../common/PersonaPickDialog', () => ({ PersonaPickDialog: (props: { footer: ReactNode }) => footer(props) }));
vi.mock('../shell/router', () => ({ navigate: () => calls.push('navigate') }));
vi.mock('../toast', () => ({ useToast: () => ({}) }));
vi.mock('../ui', async (original) => ({ ...(await original<typeof import('../ui')>()), Button: (props: { children: ReactNode; onClick: () => void }) => button(props) }));

it('closes itself before opening persona management', async () => {
  const root = probeRoot();
  try {
    const persona = { kind: 'persona', persona: { id: 'p', value: { name: 'P' } } } as unknown as PersonaChoice;
    await act(async () => root.render(<PersonaDialog persona={persona} characterName={null} pinned={undefined} onChoose={vi.fn()} onPin={vi.fn()} onClose={() => calls.push('close')} />));
    act(() => button.mock.lastCall![0].onClick());
    expect(calls).toEqual(['close', 'navigate']);
  } finally {
    await act(() => root.unmount());
  }
});
