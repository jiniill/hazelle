import { GitBranch } from 'lucide-react';
import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';
import { ACTS } from '../common/acts';
import { day } from '../common/time';
import { useChatSummary } from '../session';
import { navigate } from '../shell/router';
import { Callout, Divider, Empty, Progress, Text, TimePinContext, Viewport } from '../ui';
import { useChatEdits } from './ChatEdits';
import { FORGET_ORIGIN, LINEAGE } from './ChatLineage';
import { ChatMessage } from './ChatMessage';
import { messageRow } from './messageRow';
import type { OpenChat } from './useChat';

export function ChatLog({ chat }: { chat: OpenChat }) {
  const { item, messages, card, notUsed, personaNote, editing, timePin, modelMenu, actions } = chat;
  // Rows keep event identities while their handlers read the latest screen state, never a skipped render's closure.
  const latestActions = useRef(actions);
  useLayoutEffect(() => { latestActions.current = actions; });
  const rowActions = useMemo(() => Object.fromEntries(Object.keys(actions).map((key) => [key, (...args: unknown[]) =>
    Reflect.apply(latestActions.current[key as keyof typeof actions], undefined, args),
  ])) as typeof actions, []);
  const edits = useChatEdits();
  // The origin's name as it is now; the one kept at branch time only once the origin is gone.
  const originChat = useChatSummary(item?.chat.origin?.id ?? null);
  const origin = item?.chat.origin;
  if (chat.displayPending) return chat.displayError === undefined ? <Progress steps={[{ label: '채팅을 불러오는 중' }]} /> : (
    <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: chat.retryDisplay }}>채팅을 화면에 표시하지 못했어요.</Callout>
  );
  return <>
    {notUsed && <Text variant="note" align="center">{notUsed}</Text>}
    {personaNote && <Text variant="note" align="center">{personaNote}</Text>}
    {messages.length === 0 ? <Empty variant="story">
      {card ? '첫인사가 없는 캐릭터예요.' : '캐릭터 없이 모델과 바로 대화하는 채팅이에요.'}
    </Empty> : <TimePinContext value={timePin}><Viewport keys={chat.keys} variant="story" keep={editing ? [editing.id] : []} seek={chat.scroll.seek}
      // Story bodies are shadow roots, whose controls a row's light-DOM query cannot see: Tab stays the browser's.
      traverse={false}>{(index) => {
      const message = messages[index]!;
      const label = day(message.at);
      const divider = index === 0 || day(messages[index - 1]!.at) !== label;
      return <Fragment>
        {divider && <Divider label={label} />}
        <ChatMessage
          key={message.id}
          row={messageRow(chat, index)}
          modelMenu={modelMenu}
          actions={rowActions}
        />
        {/* Deleting the message the split comes after takes its divider with it, until 되돌리기. */}
        {origin?.after === message.id && <Divider
          icon={GitBranch}
          label={originChat !== null ? `'${originChat.title}'에서 분기됨` : `삭제된 채팅 '${origin.name}'에서 분기됨`}
          actions={[
            ...(originChat !== null ? [{ label: '원래 채팅 보기', onClick: () => navigate({ kind: 'chat', id: origin.id }) }] : []),
            { label: LINEAGE, onClick: actions.lineage },
            { label: FORGET_ORIGIN, onClick: () => edits.forgetOrigin(item!.id) },
          ]}
        />}
      </Fragment>;
    }}</Viewport></TimePinContext>}
  </>;
}
