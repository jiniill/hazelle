import { MessageSquarePlus } from 'lucide-react';
import { lazy, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Stored } from '../../model/kinds';
import { entryOf } from '../../connectors/types';
import { binsChat, isBinned, live } from '../../model/library';
import type { SideAt } from '../chat/ChatScreen';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { GuestLine } from '../common/GuestNotice';
import { Missing, type Absent } from '../common/Missing';
import { ScreenLoad } from '../common/ScreenLoad';
import { findStarred } from '../common/RolePicker';
import { NO_CHARACTER } from '../common/words';
import { ShareArrival } from '../library/ShareArrival';
import { useAccount, useCharacter, useChatModel, useChatSummary, useConnections, useSession, useSettings, useStored, useTool } from '../session';
import { Button, Callout, Empty, Intro, ListDetail, NavBar, Progress, Screen, useSplit, useWide } from '../ui';
import { backBar, navigate } from './router';
import { backTo, HOME, listOf, up, type Back, type Below, type Route } from './routes';
import { SettingsList, settingsEntry } from './settings/SettingsNav';
import { ToolsList, toolsEntry } from './tools/ToolsNav';

const ToolPageScreen = lazy(() => import('../modules/ToolPageScreen').then(({ ToolPageScreen }) => ({ default: ToolPageScreen })));
const AdminScreen = lazy(() => import('../admin/AdminScreen').then(({ AdminScreen }) => ({ default: AdminScreen })));
const AdminListScreen = lazy(() => import('../admin/AdminListScreen').then(({ AdminListScreen }) => ({ default: AdminListScreen })));
const ChatScreen = lazy(() => import('../chat/ChatScreen').then(({ ChatScreen }) => ({ default: ChatScreen })));
const ConnectionAddScreen = lazy(() => import('../connections/ConnectionAddScreen').then(({ ConnectionAddScreen }) => ({ default: ConnectionAddScreen })));
const ConnectionDirectScreen = lazy(() => import('../connections/ConnectionDirectScreen').then(({ ConnectionDirectScreen }) => ({ default: ConnectionDirectScreen })));
const ConnectionKeyScreen = lazy(() => import('../connections/ConnectionKeyScreen').then(({ ConnectionKeyScreen }) => ({ default: ConnectionKeyScreen })));
const ConnectionModelsScreen = lazy(() => import('../connections/ConnectionModelsScreen').then(({ ConnectionModelsScreen }) => ({ default: ConnectionModelsScreen })));
const ConnectionSignInScreen = lazy(() => import('../connections/ConnectionSignInScreen').then(({ ConnectionSignInScreen }) => ({ default: ConnectionSignInScreen })));
const ConnectionsScreen = lazy(() => import('../connections/ConnectionsScreen').then(({ ConnectionsScreen }) => ({ default: ConnectionsScreen })));
const CharacterEditScreen = lazy(() => import('../library/CharacterEditScreen').then(({ CharacterEditScreen }) => ({ default: CharacterEditScreen })));
const GalleryScreen = lazy(() => import('../library/gallery/GalleryScreen').then(({ GalleryScreen }) => ({ default: GalleryScreen })));
const HomeScreen = lazy(() => import('../library/HomeScreen').then(({ HomeScreen }) => ({ default: HomeScreen })));
const ModelScreen = lazy(() => import('../models/ModelScreen').then(({ ModelScreen }) => ({ default: ModelScreen })));
const ProfileScreen = lazy(() => import('../models/ProfileScreen').then(({ ProfileScreen }) => ({ default: ProfileScreen })));
const ModelsScreen = lazy(() => import('../models/ModelsScreen').then(({ ModelsScreen }) => ({ default: ModelsScreen })));
const ModuleScreen = lazy(() => import('../modules/ModuleScreen').then(({ ModuleScreen }) => ({ default: ModuleScreen })));
const ModulesScreen = lazy(() => import('../modules/ModulesScreen').then(({ ModulesScreen }) => ({ default: ModulesScreen })));
const PluginScreen = lazy(() => import('../modules/PluginScreen').then(({ PluginScreen }) => ({ default: PluginScreen })));
const PluginsScreen = lazy(() => import('../modules/PluginsScreen').then(({ PluginsScreen }) => ({ default: PluginsScreen })));
const PersonaEditor = lazy(() => import('../personas/PersonaEditor').then(({ PersonaEditor }) => ({ default: PersonaEditor })));
const PersonaList = lazy(() => import('../personas/PersonaList').then(({ PersonaList }) => ({ default: PersonaList })));
const PromptScreen = lazy(() => import('../prompts/PromptScreen').then(({ PromptScreen }) => ({ default: PromptScreen })));
const PromptsScreen = lazy(() => import('../prompts/PromptsScreen').then(({ PromptsScreen }) => ({ default: PromptsScreen })));
const AccountScreen = lazy(() => import('../settings/AccountScreen').then(({ AccountScreen }) => ({ default: AccountScreen })));
const FeatureScreen = lazy(() => import('../settings/FeatureScreen').then(({ FeatureScreen }) => ({ default: FeatureScreen })));
const ChatSettingsScreen = lazy(() => import('../settings/ChatSettingsScreen').then(({ ChatSettingsScreen }) => ({ default: ChatSettingsScreen })));
const DisplayScreen = lazy(() => import('../settings/DisplayScreen').then(({ DisplayScreen }) => ({ default: DisplayScreen })));
const ControlsScreen = lazy(() => import('../settings/ControlsScreen').then(({ ControlsScreen }) => ({ default: ControlsScreen })));
const SoundsScreen = lazy(() => import('../settings/SoundsScreen').then(({ SoundsScreen }) => ({ default: SoundsScreen })));
const UsageScreen = lazy(() => import('../settings/UsageScreen').then(({ UsageScreen }) => ({ default: UsageScreen })));
const NoticesScreen = lazy(() => import('../settings/NoticesSection').then(({ NoticesScreen }) => ({ default: NoticesScreen })));
const BoardScreen = lazy(() => import('../board/BoardScreen').then(({ BoardScreen }) => ({ default: BoardScreen })));
const PostScreen = lazy(() => import('../board/PostScreen').then(({ PostScreen }) => ({ default: PostScreen })));
const WriteScreen = lazy(() => import('../board/WriteScreen').then(({ WriteScreen }) => ({ default: WriteScreen })));
const EditScreen = lazy(() => import('../board/WriteScreen').then(({ EditScreen }) => ({ default: EditScreen })));
const ActivityScreen = lazy(() => import('../board/ActivityScreen').then(({ ActivityScreen }) => ({ default: ActivityScreen })));
const MineScreen = lazy(() => import('../board/MineScreen').then(({ MineScreen }) => ({ default: MineScreen })));
const LabsScreen = lazy(() => import('../settings/LabsScreen').then(({ LabsScreen }) => ({ default: LabsScreen })));
const TranslatorScreen = lazy(() => import('../tools/TranslatorScreen').then(({ TranslatorScreen }) => ({ default: TranslatorScreen })));
const CalculatorScreen = lazy(() => import('../tools/CalculatorScreen').then(({ CalculatorScreen }) => ({ default: CalculatorScreen })));
const ChatSide = lazy(() => import('./ChatSide').then(({ ChatSide }) => ({ default: ChatSide })));

const side = (at: SideAt) => <ScreenLoad><ChatSide {...at} /></ScreenLoad>;
type At<K extends Route['kind']> = Extract<Route, { kind: K }>;
const missing = (what: Absent, wide: boolean) => <Missing what={what} back={backTo(HOME, wide)} />;
type ItemKind = 'character' | 'prompt' | 'persona' | 'module' | 'profile';
const absentItem = <K extends ItemKind>(kind: K, stored: Stored<K> | null): K | `deleted-${K}` =>
  stored && isBinned(stored.value) ? `deleted-${kind}` : kind;

// API 연결 stacks the picked connection under its list. Every other item 설정 lists opens as a page of its own.
const VARIANTS = { connections: 'stack', 'add-connection': 'list' } as const;

// The chat, character or connection a route names is looked up here, so each screen is given what it
// shows, and Missing stands in when that is not there.
export function Page({ route, closeLayer, onPaired }: { route: Route; closeLayer: () => void; onPaired: (paired: boolean) => void }) {
  const { guest } = useAccount();
  const wide = useWide();
  const split = useSplit();
  const back = (at: Below) => backTo(up(at), wide);
  // On wide screens the sidebar beside the library's pages, or 설정's, is their way back.
  const sideBack = (at: Below) => (wide ? null : back(at));

  function screen(at: Route): ReactNode {
    switch (at.kind) {
      case 'home':
        return <HomePage />;
      case 'gallery':
        return <GalleryScreen place={at.place} back={sideBack(at)} />;
      case 'shelf':
      case 'edit':
        return <CharacterPage at={at} wide={wide} />;
      case 'new-chat':
      case 'chat':
        return <ChatPage at={at} wide={wide} onPaired={onPaired} />;
      case 'settings':
        return wide ? <Replace to={settingsEntry(true)} /> : <SettingsList onClose={closeLayer} />;
      case 'connections':
        return <ConnectionsScreen back={sideBack(at)} />;
      case 'add-connection':
        return <ConnectionAddScreen back={back(at)} />;
      case 'connect-direct':
        return <ConnectionDirectScreen key={at.address} address={at.address} back={back(at)} />;
      case 'connect': {
        const { type } = at;
        if (type.signIn) return <ConnectionSignInScreen key={type.id} type={type} signIn={type.signIn} back={back(at)} />;
        return <ConnectionKeyScreen key={type.id} type={type} back={back(at)} />;
      }
      case 'connection':
        return <ConnectionPage at={at} back={back(at)} />;
      case 'prompts':
        return <PromptsScreen place={at.place} sort={at.sort} back={sideBack(at)} />;
      case 'prompt':
        return <ItemPage at={at} back={back(at)}>{(stored) => <PromptScreen key={stored.id} stored={stored} pane={at.pane} back={back(at)} />}</ItemPage>;
      case 'personas':
        return <PersonaList place={at.place} back={sideBack(at)} />;
      case 'persona':
        return <ItemPage at={at} back={back(at)}>{(stored) => <PersonaEditor key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'modules':
        return <ModulesScreen place={at.place} back={sideBack(at)} />;
      case 'module':
        return <ItemPage at={at} back={back(at)}>{(stored) => <ModulePage key={stored.id} stored={stored} pane={at.pane} back={back(at)} />}</ItemPage>;
      case 'plugins':
        return <PluginsScreen back={sideBack(at)} />;
      case 'plugin':
        return <ItemPage at={{ kind: 'module', id: at.id }} back={back(at)}>{(stored) => <PluginScreen key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'plugin-page':
        return <ItemPage at={{ kind: 'module', id: at.id }} back={backTo({ kind: 'plugins' }, wide)}>{(stored) => <ToolPageScreen key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'models':
        return <ModelsScreen back={sideBack(at)} />;
      case 'profile':
        return <ItemPage at={at} back={back(at)}>{(stored) => <ProfileScreen key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'model':
        return <ModelPage at={at} back={back(at)} />;
      case 'account':
        return <AccountScreen section={at.section} back={sideBack(at)} />;
      case 'usage':
        return <UsageScreen back={back(at)} />;
      case 'notices':
        if (guest) return <Replace to={{ kind: 'account', section: null }} />;
        return <NoticesScreen back={back(at)} />;
      case 'chat-settings':
        return <ChatSettingsScreen back={sideBack(at)} />;
      case 'feature':
        return <FeatureScreen key={at.feature} feature={at.feature} back={back(at)} />;
      case 'display':
        return <DisplayScreen back={sideBack(at)} />;
      case 'controls':
        return <ControlsScreen back={sideBack(at)} />;
      case 'sounds':
        return <SoundsScreen back={sideBack(at)} />;
      case 'tools':
        return wide ? <Replace to={toolsEntry(true)} /> : <ToolsList onClose={closeLayer} />;
      case 'translator':
        return <TranslatorScreen back={sideBack(at)} />;
      case 'calculator':
        return <CalculatorScreen back={sideBack(at)} />;
      case 'board':
        return <BoardScreen key={String(at.operator)} operator={at.operator} category={at.category ?? null} back={sideBack(at)} />;
      case 'post':
        return <PostScreen key={at.id} id={at.id} back={back(at)} />;
      case 'board-write':
        return <WriteScreen key={`${at.operator}:${at.category}`} editing={null} operator={at.operator} category={at.category} back={back(at)} />;
      case 'board-edit':
        return <EditScreen key={at.id} id={at.id} back={back(at)} />;
      case 'board-activity':
        if (guest) return <Replace to={{ kind: 'board', operator: false }} />;
        return <ActivityScreen back={back(at)} />;
      case 'board-mine':
        return <MineScreen back={back(at)} />;
      case 'labs':
        return <LabsScreen back={sideBack(at)} />;
      // Its path can be typed by anyone; the server refuses every call but the operator's.
      case 'admin':
        return <AdminPage closeSettings={closeLayer}><AdminScreen back={sideBack(at)} /></AdminPage>;
      case 'admin-list':
        return <AdminPage closeSettings={closeLayer}><AdminListScreen list={at.list} back={back(at)} /></AdminPage>;
      case 'share':
        return <ShareArrival id={at.id} />;
    }
  }

  const list = listOf(route);
  if (!list) return <ScreenLoad>{screen(route)}</ScreenLoad>;
  const detail = route.kind === list.kind ? null : screen(route);
  const variant = VARIANTS[list.kind];
  const pane = detail ?? (list.kind === 'connections' ? <Landing /> : <Empty variant="pane">연결할 제공자를 선택해 주세요.</Empty>);
  // One boundary for the pair, so a first visit shows one loader, and one inside for the detail alone.
  if (split) return <ScreenLoad><ListDetail variant={variant} list={screen(list)} detail={<ScreenLoad>{pane}</ScreenLoad>} /></ScreenLoad>;
  return <ScreenLoad>{detail ?? screen(list)}</ScreenLoad>;
}

// API 연결 opens on its connection: the 대화 모델's, else the first, replaced before paint so 뒤로 does not land here again.
// With none, the list's own empty state speaks, and nothing stands under it.
function Landing() {
  const { models: { main } } = useSettings();
  const connections = useConnections();
  useLayoutEffect(() => {
    const id = (main && findStarred(main, connections) ? main.connection : undefined) ?? connections[0]?.id;
    if (id) navigate({ kind: 'connection', id }, { replace: true });
  }, [main, connections]);
  return null;
}

// 설정's own list is the phone's; a wide screen reached at /settings, by its address or by widening, opens the first
// page instead, replaced so 뒤로 does not land here again.
function Replace({ to }: { to: Route }) {
  useLayoutEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function HomePage() {
  const { read } = useSession();
  const populated = useSyncExternalStore(read.library.subscribe, () => read.library.snapshot().characters.length > 0);
  return populated ? <GalleryScreen place={null} back={null} lead={<GuestLine />} /> : <HomeScreen />;
}

function CharacterPage({ at, wide }: { at: At<'shelf' | 'edit'>; wide: boolean }) {
  const shelf = useCharacter(at.character);
  const stored = useStored('character', at.character);
  if (at.character === null) return (
    <Screen align="center">
      <Intro title={NO_CHARACTER} />
      <Button icon={MessageSquarePlus} onClick={() => navigate({ kind: 'new-chat', character: null })}>새 채팅</Button>
    </Screen>
  );
  if (!shelf) return missing(absentItem('character', stored), wide);
  return <CharacterEditScreen key={shelf.id} shelf={shelf} back={wide ? null : backTo(up(at), wide)} />;
}

function ChatPage({ at, wide, onPaired }: { at: At<'new-chat' | 'chat'>; wide: boolean; onPaired: (paired: boolean) => void }) {
  const stored = useStored('chat', at.kind === 'chat' ? at.id : null);
  const summary = useChatSummary(at.kind === 'chat' ? at.id : null);
  const chatModel = useChatModel(at.kind === 'chat' ? at.id : null);
  const character = at.kind === 'new-chat' ? at.character : stored?.value.character;
  const shelf = useCharacter(character ?? null);
  const characterStored = useStored('character', character ?? null);
  // Keep new/saved chat routes under one component/key to avoid remounting on first save.
  // Preserve id for greeting/rollp seeds; discard it on other routes so later new chats never reuse a spent id.
  const [fresh, setFresh] = useState<{ character: string | null; id: string } | null>(null);
  let newChat = fresh;
  if (at.kind === 'new-chat' ? fresh?.character !== at.character : fresh !== null) {
    newChat = at.kind === 'new-chat' ? { character: at.character, id: crypto.randomUUID() } : null;
    setFresh(newChat);
  }
  const back = backTo(up(at, summary?.chat.character), wide);
  if (at.kind === 'new-chat') {
    if (at.character !== null && !shelf) return missing(absentItem('character', characterStored), wide);
    return <ChatScreen key={newChat!.id} id={newChat!.id} item={null} shelf={shelf} back={wide ? null : back} side={side} onPaired={onPaired} />;
  }
  if (!summary) {
    return missing(stored && binsChat(stored.value, () => shelf !== null) ? 'deleted-chat' : 'chat', wide);
  }
  const item = chatModel.model;
  if (!item || chatModel.state !== 'loaded') return (
    <Screen align="center" top={<NavBar title={summary.title} {...backBar(back)} />}>
      {chatModel.state === 'failed' ? (
        <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: chatModel.retry }}>
          {describeFailure(chatModel.error!)}
        </Callout>
      ) : (
        <Progress steps={[{ label: '채팅을 불러오는 중' }]} />
      )}
    </Screen>
  );
  if (character !== null && !shelf) return missing('orphaned-chat', wide);
  return <ChatScreen key={item.id} id={item.id} item={item} shelf={shelf} back={wide ? null : back} side={side} onPaired={onPaired} />;
}

function ItemPage<K extends 'prompt' | 'persona' | 'module' | 'profile'>({ at, back, children }: { at: { kind: K; id: string }; back: Back; children: (stored: Stored<K>) => ReactNode }) {
  const stored = useStored(at.kind, at.id);
  const shown = live(stored);
  if (!shown) return <Missing what={absentItem(at.kind, stored)} back={back} />;
  return children(shown);
}

// A plugin's page was a module's until 플러그인 had a page of its own, so an old link to one lands on its new place.
function ModulePage({ stored, pane, back }: { stored: Stored<'module'>; pane: 'toggles' | null; back: Back }) {
  const plugin = useTool(stored.id) !== null;
  useLayoutEffect(() => {
    if (plugin) navigate({ kind: 'plugin', id: stored.id }, { replace: true });
  }, [plugin, stored.id]);
  return plugin ? null : <ModuleScreen stored={stored} pane={pane} back={back} />;
}

function ConnectionPage({ at, back }: { at: At<'connection'>; back: Back }) {
  const stored = useStored('connection', at.id);
  return stored ? <ConnectionModelsScreen key={stored.id} stored={stored} back={back} /> : <Missing what="connection" back={back} />;
}

function ModelPage({ at, back }: { at: At<'model'>; back: Back }) {
  const connection = useStored('connection', at.connection);
  const model = connection && entryOf(connection.value, at.model);
  return connection && model ? <ModelScreen key={`${connection.id}/${at.model}`} connection={connection} model={model} back={back} /> : <Missing what="model" back={back} />;
}

function AdminPage({ closeSettings, children }: { closeSettings: () => void; children: ReactNode }) {
  const { admin } = useAccount();
  return admin ? children : <SettingsList onClose={closeSettings} />;
}
