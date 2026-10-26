import { toolMenu } from './toolMenu';
import { refOf } from '../../connectors/assignment';
import { entryName } from '../../connectors/types';
import { BookKey, BookOpen, Bookmark, Brain, Keyboard, MessageSquarePlus, Package, PlaneTakeoff, ScanSearch, Search, SlidersHorizontal, SquarePen, ToggleRight, UsersRound } from 'lucide-react';
import { ACTS } from '../common/acts';
import { FeatureSwitches } from '../common/FeatureSwitches';
import { AgentSwitches } from '../common/AgentSwitches';
import { NameDialog } from '../common/NameDialog';
import { BOOKMARK, CAST, CHAT_LORE, EXPORT, FEATURE_NAMES, FEATURES_TITLE, NO_CHARACTER } from '../common/words';
import { useRemembering, useSession, useToolFrames } from '../session';
import { navigate } from '../shell/router';
import { runShortcut } from '../shortcuts';
import { Avatar, ChatTitle, Divider, Menu, MenuItem, MoreMenu, ToolButton, useMenuHandle, useMenuOpener, useWide } from '../ui';
import { ChatCastMenu } from './ChatCastMenu';
import { ChatExport } from './ChatExport';
import { ChatModelMenu } from './ChatModelMenu';
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
      sub={item?.title ?? '새 채팅'}
      face={shelf && card && <Avatar face={card.name} image={shelf.face} size="sm" />}
      expanded={shelf ? open : undefined}
      onClick={shelf ? () => (open ? actions.closePanel() : actions.side({ kind: 'character', id: shelf.id, part: null })) : undefined}
    />
  );
}

export function ChatHeaderActions({ chat }: { chat: OpenChat }) {
  const { id, item, shelf, cast, route, toggles, panel, features, modelMenu, castMenu, actions } = chat;
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
  const label = 'kind' in route ? '모델 선택' : entryName(route.model);
  const current = 'kind' in route ? null : refOf(route.connection.id, route.model);
  return (
    <>
      <ChatPromptPicker prompt={chat.prompt} open={chat.dialog === 'prompt'} onOpen={() => actions.openDialog('prompt')} />
      <ChatCastMenu handle={castMenu} cast={cast} character={shelf?.id ?? null} onChange={actions.setCast} />
      <ChatModelMenu handle={modelMenu} current={current} label={label} onPick={actions.pickModel} />
      {item && (
        <Menu kind="dialog" size="form" handle={featuresMenu} place="below-end" label={FEATURES_TITLE} trigger={() => null}>
          <FeatureSwitches owner={{ kind: 'chat', id: item.id }} own={item.chat.features} />
          <AgentSwitches owner={{ kind: 'chat', id: item.id }} own={item.chat.agents ?? []} />
        </Menu>
      )}
      <ToolButton
        icon={SlidersHorizontal}
        label="토글"
        detail={toggles.changed ? `변경 ${toggles.changed}개` : undefined}
        mark={{ kind: 'count', count: toggles.changed }}
        phone="icon"
        expanded={panel?.kind === 'toggles'}
        onClick={actions.flipToggles}
      />
      <MoreMenu of="채팅" dot={failed}>
        {shelf && <MenuItem icon={SquarePen} label="캐릭터 편집" onClick={() => actions.side({ kind: 'character', id: shelf.id, part: null })} />}
        {!wide && <MenuItem icon={MessageSquarePlus} label="새 채팅" onClick={() => navigate({ kind: 'new-chat', character: shelf?.id ?? null })} />}
        {item && <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => actions.openDialog('rename')} />}
        <MenuItem icon={UsersRound} label={CAST} sub={cast.length ? `${cast.length}명` : undefined} onClick={openCast.onClick} />
        {item && !chat.displayPending && <MenuItem icon={ACTS.export.icon} label={EXPORT} onClick={() => actions.openDialog('export')} />}
        <Divider variant="menu" />
        <MenuItem icon={Search} label="검색" onClick={actions.openSearch} />
        {item && !chat.displayPending && <MenuItem icon={Bookmark} label={BOOKMARK} onClick={actions.bookmarks} />}
        {item && features.memory && <MenuItem icon={Brain} label={FEATURE_NAMES.memory} sub={failed ? '정리 실패' : indexing ? `검색 준비 ${indexing.done}/${indexing.total}` : undefined} onClick={toggleMemory} />}
        {item && <MenuItem icon={ToggleRight} label={FEATURES_TITLE} onClick={openFeatures.onClick} />}
        {item && <MenuItem icon={BookKey} label={CHAT_LORE} onClick={actions.lore} />}
        <MenuItem icon={ScanSearch} label="점검" onClick={() => actions.openInspect('request')} />
        {item && <MenuItem icon={PlaneTakeoff} label="오토파일럿" onClick={actions.autopilot} />}
        {tools.length > 0 && <>
          <Divider variant="menu" />
          {tools.map((tool) => <MenuItem key={`${tool.module}:${tool.kind === 'page' ? 'page' : `menu:${tool.item}`}`} icon={Package} label={tool.label} sub={tool.name} checked={tool.kind === 'page' ? panel?.kind === 'tool' && panel.module === tool.module : undefined} onClick={() => tool.kind === 'page' ? actions.tool(tool.module) : actions.toolMenu(tool.module, tool.item)} />)}
        </>}
        <Divider variant="menu" />
        <MenuItem icon={BookOpen} label="읽기 설정" onClick={() => actions.openDialog('reading')} />
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
  if (dialog === 'prompt') return <PromptDialog prompt={chat.prompt} onChoose={actions.setPrompt} onEdit={(id) => actions.side({ kind: 'prompts', id, pane: null })} onClose={actions.closeDialog} />;
  if (dialog === 'reading') return <ReadingDialog onClose={actions.closeDialog} />;
  if (dialog === 'export' && item) return <ChatExport item={item} messages={chat.messages} view={chat.view} placed={chat.placed} pictures={chat.pictures} flipped={chat.flipped} busy={chat.busy} bot={chat.decor.bot} characterName={chat.card?.name ?? null} names={chat.names} replyLanguage={chat.translate.replyLanguage} onTranslate={chat.features.translate ? actions.translate : undefined} onClose={actions.closeDialog} />;
  if (dialog === 'rename' && item) {
    return <NameDialog title="채팅 이름 바꾸기" value={item.title} blank="비워 두면 첫 메시지가 제목으로 표시돼요." onSave={actions.rename} onClose={actions.closeDialog} />;
  }
  return null;
}
