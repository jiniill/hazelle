import type { ReactNode } from 'react';
import type { From } from '../../engine/pipeline';
import type { Sending } from '../../runtime/turn-context';
import { describeTurnFailure } from '../common/failure';
import { useSession } from '../session';
import { Empty, SidePanel, Tabs, Text } from '../ui';
import { Cache, NextCacheView } from './InspectCache';
import { Log } from './InspectLog';
import { Modules } from './InspectModules';
import { NextRequest } from './InspectRequest';
import { Scripts } from './InspectScripts';
import { Variables } from './InspectVariables';
import { editorOf, type InspectTab, type Side } from './panels';
import type { OpenChat } from './useChat';
import type { SendNotes } from './useSendNotes';

const TABS: { value: InspectTab; label: string }[] = [
  { value: 'request', label: '요청' },
  { value: 'cache', label: '캐시' },
  { value: 'variables', label: '변수' },
  { value: 'modules', label: '모듈' },
  { value: 'scripts', label: '스크립트' },
  { value: 'log', label: '기록' },
];

type ChatInspectProps = Pick<OpenChat, 'busy' | 'prompt'> & { chat: string; character: string | null; tab: InspectTab; notes: SendNotes; onTab: (tab: InspectTab) => void; onClose: () => void; onEdit: (side: Side) => void };

// 점검: every tab before a send reads the composer's one next-send result (useSendNotes), never a prompt of its own.
export function ChatInspect({ chat, character, tab, notes, busy, prompt, onTab, onClose, onEdit }: ChatInspectProps) {
  const { store } = useSession();
  const conversation = prompt.kind === 'prompt' ? { id: prompt.prompt.id, blocks: prompt.prompt.value.blocks } : null;
  const editor = (from: From) => editorOf(from, conversation, character, (lore) => store.get('lore', lore)?.parent ?? null);
  const tabs = <Tabs label="점검" items={TABS} value={tab} onChange={onTab} />;
  const ready = (view: (sending: Sending) => ReactNode) =>
    busy ? <Empty variant="section">응답이 끝나면 다시 계산해요.</Empty>
    : notes.sending === null ? <Empty variant="section">지금은 요청을 보낼 수 없어서 계산하지 못했어요.</Empty>
    : notes.sending && 'turn' in notes.sending ? view(notes.sending)
    : notes.sending ? <Empty variant="section">{describeTurnFailure(notes.sending)}</Empty>
    : <Text variant="note">계산하는 중…</Text>;
  return (
    <SidePanel title="점검" onClose={onClose}>
      {tabs}
      {tab === 'request' && ready((sending) => <NextRequest chat={chat} sending={sending} request={notes.request} editor={editor} onEdit={onEdit} />)}
      {tab === 'cache' && <Cache chat={chat} cache={notes.cache} next={ready((sending) => <NextCacheView chat={chat} sending={sending} cache={notes.cache} editor={editor} onEdit={onEdit} />)} />}
      {tab === 'variables' && <Variables chat={chat} sending={notes.sending && 'turn' in notes.sending ? notes.sending : null} busy={busy} />}
      {tab === 'modules' && ready((sending) => <Modules sending={sending} />)}
      {tab === 'scripts' && <Scripts chat={chat} />}
      {tab === 'log' && <Log chat={chat} />}
    </SidePanel>
  );
}
