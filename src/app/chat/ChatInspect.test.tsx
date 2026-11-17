import { act, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { REGEX_OFF } from '../common/words';
import { probeRoot } from '../ui/probe';
import { ChatInspect } from './ChatInspect';
import type { OpenChat } from './useChat';
import type { SendNotes } from './useSendNotes';

const said = vi.fn<(props: { children: string }) => null>(() => null);
vi.mock('../session', () => ({ useSession: () => ({ store: {} }) }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  SidePanel: ({ children }: { children: ReactNode }) => children,
  Tabs: () => null,
  Empty: (props: { children: string }) => said(props),
}));

it("says the regex is off, not that nothing can be sent, while the chat's verdict refuses the forecast", async () => {
  const root = probeRoot();
  const panel = (stuck: boolean) => <ChatInspect chat="chat" character={null} tab="request" call={undefined} notes={{ sending: null } as SendNotes} busy={false} stuck={stuck} prompt={{ kind: 'missing' } as OpenChat['prompt']} onTab={() => {}} onClose={() => {}} onEdit={() => {}} />;
  try {
    await act(async () => root.render(panel(true)));
    expect(said.mock.lastCall![0].children).toContain(REGEX_OFF);
    await act(async () => root.render(panel(false)));
    expect(said.mock.lastCall![0].children).toBe('지금은 요청을 보낼 수 없어서 계산하지 못했어요.');
  } finally {
    await act(() => root.unmount());
  }
});
