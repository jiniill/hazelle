import { FEATURE_ICONS } from '../common/featureIcons';
import { toolMenu } from './toolMenu';
import { BookKey, BookOpen, Bookmark, ClipboardList, FolderInput, GitGraph, Keyboard, Package, PanelRight, PlaneTakeoff, ScanSearch, Search, SlidersHorizontal, Smartphone, SquarePen, ToggleRight, UsersRound } from 'lucide-react';
import { ACTS } from '../common/acts';
import { FeatureSwitches } from '../common/FeatureSwitches';
import { AgentSwitches } from '../common/AgentSwitches';
import type { Writes } from '../../model/chat';
import { BOOKMARK, CAST, CHAT_LORE, EXPORT, FEATURE_NAMES, FEATURES_TITLE, LINEAGE, NO_CHARACTER, ONBOARDING, PHONE, STATUS_DETAIL, READING_SETTINGS } from '../common/words';
import { useRemembering, useSession, useToolFrames } from '../session';
import { navigate } from '../shell/router';
import { runShortcut } from '../shortcuts';
import { Avatar, ChatTitle, Divider, IconButton, Menu, MenuItem, MoreMenu, ToolButton, useAside, useMenuHandle, useMenuOpener, useWide } from '../ui';
import { ChatCastMenu } from './ChatCastMenu';
import { ChatOnboarding } from './ChatOnboarding';
import { MOVE_TO_FOLDER } from '../common/folders/FolderParts';
import { ChatNameDialog } from './ChatEdits';
import { ChatFolderMenu, useChatFolders } from './ChatFolderMenu';
import { useFamily } from './ChatLineage';
import { alone } from './lineage';
import { ChatExport } from './ChatExport';
import { ChatModel } from './ChatModel';
import { PersonaDialog } from './ChatPersonaPicker';
import { ChatPromptPicker, PromptDialog } from './ChatPromptPicker';
import { ReadingDialog } from './ChatReading';
import { SceneDialog } from './ChatPicture';
import type { OpenChat } from './useChat';

export function ChatHeading({ chat }: { chat: OpenChat }) {
  const { item, card, shelf, panel, actions } = chat;
  const open = panel?.kind === 'character';
  return (
    <ChatTitle
      name={card?.name ?? NO_CHARACTER}
      description={item?.title ?? ACTS.newChat.label}
      face={shelf && card && <Avatar face={card.name} image={shelf.face} size="sm" />}
      expanded={shelf ? open : undefined}
      onClick={shelf ? () => (open ? actions.closePanel() : actions.side({ kind: 'character', id: shelf.id, part: null })) : undefined}
      onRename={item ? () => actions.openDialog('rename') : undefined}
    />
  );
}

export function ChatHeaderActions({ chat }: { chat: OpenChat }) {
  const { id, item, place, shelf, cast, toggles, panel, features, castMenu, actions } = chat;
  const remembering = useRemembering();
  const session = useSession();
  // Subscribed for items, which read the frame tools' registrations.
  useToolFrames();
  const tools = toolMenu(chat.tools, session.tools.items);
  const failed = features.memory && id !== null && remembering.failed.has(id);
  const indexing = features.memory && id !== null ? remembering.indexing.get(id) : undefined;
  const toggleMemory = () => (panel?.kind === 'memory' ? actions.closePanel() : actions.memory(null));
  const wide = useWide();
  const openCast = useMenuOpener(castMenu);
  const featuresMenu = useMenuHandle();
  const openFeatures = useMenuOpener(featuresMenu);
  const folderMenu = useMenuHandle();
  const openFolders = useMenuOpener(folderMenu);
  const folders = useChatFolders(shelf?.id ?? null);
  const fileable = item && folders.index.folders.length > 0;
  const aside = useAside();
  return (
    <>
      <ChatPromptPicker prompt={chat.prompt} out={chat.promptOut && chat.card === null} open={chat.dialog === 'prompt'} onOpen={() => actions.openDialog('prompt')} />
      <ChatCastMenu handle={castMenu} cast={cast} character={shelf?.id ?? null} onChange={actions.setCast} />
      {!aside && <ChatModel chat={chat} />}
      {fileable && <ChatFolderMenu handle={folderMenu} chat={item.id} folder={item.chat.folder ?? null} folders={folders} />}
      <Menu kind="dialog" size="form" handle={featuresMenu} place="below-end" label={FEATURES_TITLE} trigger={() => null}>
        <FeatureSwitches owner={{ kind: 'chat', chat: place }} own={place.features} onChange={actions.setFeature} />
        <AgentSwitches owner={{ kind: 'chat', chat: place }} own={place.agents ?? []} onChange={actions.setAgent} />
      </Menu>
      <ToolButton
        icon={SlidersHorizontal}
        label="토글"
        detail={toggles.changed ? `변경 ${toggles.changed}개` : undefined}
        mark={{ kind: 'count', count: toggles.changed }}
        phone="icon"
        expanded={panel?.kind === 'toggles'}
        onClick={actions.flipToggles}
      />
      {/* One press where the header has room; in the ⋯ where it does not. */}
      {item && wide && <IconButton icon={ACTS.star.icon} label={ACTS.star.label} size="sm" pressed={item.chat.starred ?? false} onClick={actions.star} />}
      <MoreMenu of="채팅" dot={failed}>
        {shelf && <MenuItem icon={SquarePen} label="캐릭터 편집" onClick={() => actions.side({ kind: 'character', id: shelf.id, part: null })} />}
        {!wide && <MenuItem icon={ACTS.newChat.icon} label={ACTS.newChat.label} onClick={() => navigate({ kind: 'new-chat', character: shelf?.id ?? null })} />}
        {item && <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => actions.openDialog('rename')} />}
        {item && !wide && <MenuItem icon={ACTS.star.icon} label={ACTS.star.label} checked={item.chat.starred ?? false} multiple onClick={actions.star} />}
        {item && <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={actions.duplicate} />}
        {fileable && <MenuItem icon={FolderInput} label={MOVE_TO_FOLDER} onClick={openFolders.onClick} />}
        {chat.onboarding && <MenuItem icon={ClipboardList} label={ONBOARDING} onClick={() => actions.openDialog('onboarding')} />}
        <MenuItem icon={UsersRound} label={CAST} description={cast.length ? `${cast.length}명` : undefined} onClick={openCast.onClick} />
        {item && !chat.displayPending && <MenuItem icon={ACTS.export.icon} label={EXPORT} onClick={() => actions.openDialog('export')} />}
        <Divider variant="menu" />
        <MenuItem icon={Search} label="검색" onClick={actions.openSearch} />
        {item && !chat.displayPending && <MenuItem icon={Bookmark} label={BOOKMARK} onClick={actions.bookmarks} />}
        {item && <LineageItem current={item.id} shelf={shelf} onClick={actions.lineage} />}
        {item && features.memory && <MenuItem icon={FEATURE_ICONS.memory} label={FEATURE_NAMES.memory} description={failed ? '정리 실패' : indexing ? `검색 준비 ${indexing.done}/${indexing.total}` : undefined} onClick={toggleMemory} />}
        <MenuItem icon={ToggleRight} label={FEATURES_TITLE} onClick={openFeatures.onClick} />
        {item && <MenuItem icon={BookKey} label={CHAT_LORE} onClick={actions.lore} />}
        {chat.states.length > 0 && <MenuItem icon={PanelRight} label={STATUS_DETAIL} onClick={actions.stateDetail} />}
        {chat.states.some(({ apps }) => apps.length > 0) && <MenuItem icon={Smartphone} label={PHONE} onClick={actions.phone} />}
        <MenuItem icon={ScanSearch} label="점검" onClick={() => actions.openInspect('request')} />
        {item && <MenuItem icon={PlaneTakeoff} label="오토파일럿" onClick={actions.autopilot} />}
        {tools.length > 0 && <>
          <Divider variant="menu" />
          {tools.map((tool) => <MenuItem key={`${tool.module}:${tool.kind === 'page' ? 'page' : `menu:${tool.item}`}`} icon={Package} label={tool.label} description={tool.name} checked={tool.kind === 'page' ? panel?.kind === 'tool' && panel.module === tool.module : undefined} onClick={() => tool.kind === 'page' ? actions.tool(tool.module) : actions.toolMenu(tool.module, tool.item)} />)}
        </>}
        <Divider variant="menu" />
        <MenuItem icon={BookOpen} label={READING_SETTINGS} onClick={() => actions.openDialog('reading')} />
        <MenuItem icon={Keyboard} label="단축키" onClick={() => runShortcut('shortcutList')} />
        {item && (
          <>
            <Divider variant="menu" />
            <MenuItem icon={ACTS.remove.icon} label="이 채팅 삭제" tone="warn" onClick={actions.drop} />
          </>
        )}
      </MoreMenu>
    </>
  );
}

// 분기 지도 is offered where it has a family to draw: a branch, a copy or an original.
function LineageItem({ current, shelf, onClick }: { current: string; shelf: OpenChat['shelf']; onClick: () => void }) {
  return alone(useFamily(current, shelf)) ? null : <MenuItem icon={GitGraph} label={LINEAGE} onClick={onClick} />;
}

// The persona and prompt dialogs mount here, not beside their chips: a folded composer hides its tool bar and a hidden
// header its actions, and a dialog inside them.
export function ChatDialogs({ chat }: { chat: OpenChat }) {
  const { dialog, item, reshaping, pictureSizes, actions } = chat;
  if (reshaping) return <SceneDialog reshaping={reshaping} sizes={pictureSizes} onDraw={actions.draw} onClose={() => actions.reshape(null)} />;
  if (dialog === 'persona') return (
    <PersonaDialog
      persona={chat.persona}
      characterName={chat.shelf?.character.card.name ?? null}
      pinned={chat.shelf?.character.persona}
      onChoose={actions.choosePersona}
      onPin={actions.pinPersona}
      onClose={actions.closeDialog}
    />
  );
  if (dialog === 'prompt') return <PromptDialog prompt={chat.prompt} plain={chat.card === null} out={chat.promptOut && chat.card === null} onChoose={actions.setPrompt} onKeepOut={actions.keepPromptOut} onEdit={(id) => actions.side({ kind: 'prompts', id, pane: null })} onClose={actions.closeDialog} />;
  if (dialog === 'reading') return <ReadingDialog character={chat.shelf && { id: chat.shelf.id, look: chat.shelf.character.look }} onClose={actions.closeDialog} />;
  if (dialog === 'onboarding' && chat.onboarding) {
    const done = (answers: Writes) => {
      actions.startWith(answers);
      actions.closeDialog();
    };
    return <ChatOnboarding chatId={chat.chatId} chat={chat.place} onboarding={chat.onboarding} name={chat.card!.name} onDone={done} onClose={actions.closeDialog} />;
  }
  if (dialog === 'export' && item) return <ChatExport item={item} messages={chat.messages} view={chat.view} placed={chat.placed} pictures={chat.pictures} flipped={chat.flipped} shownTranslation={chat.shownTranslation} busy={chat.busy} bot={chat.decor.bot} characterName={chat.card?.name ?? null} names={chat.names} replyLanguage={chat.translate.replyLanguage} onTranslate={chat.features.translate ? actions.translate : undefined} onClose={actions.closeDialog} />;
  if (dialog === 'rename' && item) {
    return <ChatNameDialog title={item.title} origin={item.chat.origin !== undefined} onSave={actions.rename} onClose={actions.closeDialog} />;
  }
  return null;
}
