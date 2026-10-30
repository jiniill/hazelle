import { ChatToolPanel } from './ChatToolPanel';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import type { ChatItem, ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useShortcut } from '../shortcuts';
import { useToastFloor } from '../toast';
import { useDisplay } from '../display';
import { useAssetUrl } from '../session';
import { day } from '../common/time';
import { aimedAtPanel, ChatFrame, Pill, Scrubber, SidePeeks, StepButtons, usePanelsBeside, useWide } from '../ui';
import { ChatAutopilot } from './ChatAutopilot';
import { ChatBookmarks } from './ChatBookmarks';
import { ChatInspect } from './ChatInspect';
import { ChatComposer } from './ChatComposer';
import { ChatDialogs, ChatHeaderActions, ChatHeading } from './ChatHeader';
import { ChatInfo } from './ChatInfo';
import { ChatLog } from './ChatLog';
import { ChatMemory } from './ChatMemory';
import { ChatMemoryRecord } from './ChatMemoryRecord';
import { ChatSearch } from './ChatSearch';
import { ChatStatusPeek } from './ChatStatus';
import { ChatToggles } from './ChatToggles';
import { useEditBeside } from './characterBeside';
import { promptEditor, toggleEditor, type Panel, type Side } from './panels';
import { useAutopilot } from './useAutopilot';
import { useChat } from './useChat';

// The lorebook panel brings the lorebook editor and the CBS language with it, so a chat loads them only when it opens.
const ChatLore = lazy(() => import('./ChatLore').then(({ ChatLore }) => ({ default: ChatLore })));

const STEP_LABELS = { up: '위로 · 길게 누르면 맨 위로', down: '아래로 · 길게 누르면 맨 아래로' };

// What the shell draws for a Side: the persona, prompt and character screens are other features, which only the shell composes.
export type SideAt = { open: Side; inUse: string | null; onOpen: (open: Panel) => void; onClose: () => void };

type Props = {
  id: string;
  // null for a new chat, which is saved with its first message.
  item: ChatItem | null;
  shelf: CharacterShelf<ChatSummary> | null;
  back: Back | null;
  side: (at: SideAt) => ReactNode;
  // Told while two panels stand beside the story, so the shell can make room.
  onPaired: (paired: boolean) => void;
};

export function ChatScreen({ id: chatId, item, shelf, back, side, onPaired }: Props) {
  const { reading, display } = useDisplay();
  const chat = useChat(chatId, item, shelf, reading.reply);
  const { id, busy, panel, scroll, prompt, actions } = chat;
  const autopilot = useAutopilot(chat);
  const wide = useWide();
  const folded = (display.foldComposer && scroll.away) || (!wide && chat.editing !== null);
  const url = useAssetUrl([display.portrait, display.hidePictures, shelf?.avatar]);
  // The thumbnail stands in until the full picture is read.
  const portrait = display.portrait && !display.hidePictures && shelf?.avatar ? (url('avatar', shelf.avatar) ?? shelf.face ?? undefined) : undefined;
  useShortcut('personas', () => actions.openDialog('persona'));
  useShortcut('prompts', () => actions.openDialog('prompt'));
  useEditBeside(shelf?.id ?? null, () => shelf && actions.side({ kind: 'character', id: shelf.id, part: null }));
  useShortcut('status', () => {
    if (!chat.status.length) return false;
    actions.hold(!chat.held);
  });
  // The chat's search reads only the story; a panel's text is the browser's to find.
  useShortcut('find', (event) => {
    if (event && aimedAtPanel(event)) return false;
    actions.openSearch();
  });
  useShortcut('inspect', () => {
    if (chat.inspect) actions.closeInspect();
    else actions.openInspect('request');
  });
  const inUse = prompt.kind === 'prompt' ? prompt.prompt.id : null;
  const inspect = chat.inspect && <ChatInspect chat={chatId} tab={chat.inspect.tab} notes={chat.sendNotes} busy={busy} prompt={prompt} character={shelf?.id ?? null} onTab={actions.switchInspectTab} onClose={actions.closeInspect} onEdit={actions.side} />;
  const paired = usePanelsBeside() && !!panel && !!chat.inspect;
  useEffect(() => {
    onPaired(paired);
    return () => onPaired(false);
  }, [paired, onPaired]);
  return (
    <>
      <ChatFrame
        back={back ? { label: back.label, onClick: () => navigate(back.to) } : undefined}
        title={chat.search ? <ChatSearch search={chat.search} onSearch={actions.searchFor} onStep={actions.stepSearch} onClose={actions.closeSearch} /> : <ChatHeading chat={chat} />}
        actions={<ChatHeaderActions chat={chat} />}
        above={scroll.pill && <Pill label={scroll.pill} live={busy} onClick={actions.follow} />}
        footer={<ChatComposer chat={chat} folded={folded} />}
        dockRef={useToastFloor()}
        panel={
          panel?.kind === 'toggles' ? (
            <ChatToggles card={chat.card} toggles={chat.toggles} toggleOwner={chat.toggleOwner} onFlip={actions.flip} onWrite={actions.writeToggle} onReset={actions.resetToggles} onEdit={(section) => actions.side(toggleEditor(section))} onClose={actions.closePanel} />
          ) : panel?.kind === 'info' ? (
            <ChatInfo id={id} shelf={shelf} messages={chat.messages} view={chat.view} infoPick={chat.infoPick} tab={panel.tab} onTab={actions.switchInfoTab} onPick={actions.pickInfo} onRecord={chat.features.memory ? actions.memory : undefined} onEdit={actions.side} onCache={() => actions.openInspect('cache')} onClose={actions.closePanel} />
          ) : panel?.kind === 'memory' ? (
            chat.item && <ChatMemory
              record={panel.record}
              item={chat.item}
              messages={chat.messages}
              busy={busy}
              onClose={actions.closePanel}
              onTool={actions.tool}
              onEditPrompt={prompt.kind === 'prompt' ? () => actions.side({ kind: 'prompts', id: prompt.prompt.id, pane: null }) : undefined}
              onEditTaskPrompt={(door) => actions.side(promptEditor(door))}
              onRecord={actions.memory}
              renderRecord={(record) => <ChatMemoryRecord {...record} actions={actions} />}
            />
          ) : panel?.kind === 'bookmarks' ? (
            chat.item && <ChatBookmarks item={chat.item} messages={chat.messages} texts={chat.texts} names={chat.names} onShow={actions.showBookmark} onUnmark={actions.bookmark} onRename={actions.renameBookmark} onClose={actions.closePanel} />
          ) : panel?.kind === 'autopilot' ? (
            <ChatAutopilot autopilot={autopilot} busy={busy} onClose={actions.closePanel} />
          ) : panel?.kind === 'lore' ? (
            id && (
              <Suspense fallback={null}>
                <ChatLore id={id} onClose={actions.closePanel} />
              </Suspense>
            )
          ) : panel?.kind === 'tool' ? (
            id && <ChatToolPanel key={panel.module} chat={id} module={panel.module} onClose={actions.closePanel} />
          ) : panel ? (
            side({ open: panel, inUse, onOpen: actions.side, onClose: actions.closePanel })
          ) : (
            inspect
          )
        }
        beside={panel && inspect}
        edge={
          <>
            {display.scrubber && <Scrubber scrollRef={scroll.scrollRef} keys={chat.keys} stops={chat.stops} label={(index) => `#${index + 1} · ${day(chat.messages[index]!.at)}`} onSeek={actions.seek} />}
            {display.stepButtons && chat.messages.length > 0 && <StepButtons scrollRef={scroll.scrollRef} labels={STEP_LABELS} onStep={actions.step} onEnd={actions.toEnd} />}
          </>
        }
        peek={
          <SidePeeks>
            {chat.peeking && <ChatStatusPeek status={chat.status} held={chat.held} decor={chat.decor} onHold={actions.hold} onPress={actions.press} onUnmark={(script) => actions.markStatus(script, false)} />}
          </SidePeeks>
        }
        reading={reading}
        hideHeader={display.hideHeader}
        stage={chat.stage && !display.inlineIllustrations}
        side={display.pictureSide}
        portrait={portrait}
        pictures={{ ...shelf?.character.pictures, widest: shelf?.character.pictures?.widest ?? display.pictureWidest, wideFill: display.wideFill }}
        compact={folded}
        scrollRef={scroll.scrollRef}
        onScroll={scroll.onScroll}
      >
        <ChatLog chat={chat} />
      </ChatFrame>
      <ChatDialogs chat={chat} />
    </>
  );
}
