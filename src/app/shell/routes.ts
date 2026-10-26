import { CONNECTION_TYPES } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { CATEGORIES, type Category } from '../../contracts/board';
import { SHARE_ID } from '../../contracts/shares';
import { FEATURES, type Feature } from '../../model/features';
import type { Shelf } from '../../model/library';
import { PROMPT_SORTS, type PromptSort } from '../../model/prompt';

const ACCOUNT_SECTIONS = ['notices'] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];
const PROMPT_PANES = ['toggles', 'model', 'picture'] as const;
export type PromptPane = (typeof PROMPT_PANES)[number];

// These paths are what a reload, a bookmark and the browser's back button land on, so an existing one never changes.
export type Route =
  | { kind: 'home' }
  | { kind: 'gallery'; place: string | null }
  // character null is 캐릭터 없이.
  | { kind: 'shelf'; character: string | null }
  | { kind: 'edit'; character: string }
  | { kind: 'new-chat'; character: string | null }
  | { kind: 'chat'; id: string }
  | { kind: 'connections' }
  | { kind: 'add-connection' }
  | { kind: 'connect'; type: ConnectionType }
  // '' when there was none.
  | { kind: 'connect-direct'; address: string }
  | { kind: 'connection'; id: string }
  // pane: the prompt editor's pane that is open, which a door to a prompt's 토글, 모델 or 이미지 names; null, a block.
  // place on a list of things that folders hold: a folder's id, or null for the top.
  | { kind: 'prompts'; place: string | null; sort: PromptSort | null }
  | { kind: 'prompt'; id: string; pane: PromptPane | null }
  | { kind: 'personas'; place: string | null }
  | { kind: 'persona'; id: string }
  | { kind: 'modules'; place: string | null }
  | { kind: 'module'; id: string; pane: 'toggles' | null }
  // A plugin is stored as a module that holds a tool; id is that module's.
  | { kind: 'plugins' }
  | { kind: 'plugin'; id: string }
  | { kind: 'plugin-page'; id: string }
  | { kind: 'models' }
  | { kind: 'profile'; id: string }
  // model: an added model's key (connectors/types entryKey), which may hold any character; the path carries it escaped.
  | { kind: 'model'; connection: string; model: string }
  // section opens the page at 운영자가 보낸 알림, which the toast saying one came links to.
  | { kind: 'account'; section: AccountSection | null }
  | { kind: 'usage' }
  | { kind: 'notices' }
  | { kind: 'chat-settings' }
  | { kind: 'feature'; feature: Feature }
  | { kind: 'display' }
  | { kind: 'controls' }
  | { kind: 'sounds' }
  | { kind: 'tools' }
  | { kind: 'translator' }
  | { kind: 'calculator' }
  // 게시판 (design §6.13). operator: the operator-only posts, listed or preset in the compose.
  // category: the tab open, none for 전체; in a compose, the one a fresh post starts with.
  | { kind: 'board'; operator: boolean; category?: Category }
  | { kind: 'post'; id: number }
  | { kind: 'board-write'; operator: boolean; category?: Category }
  | { kind: 'board-edit'; id: number }
  | { kind: 'board-activity' }
  | { kind: 'board-mine' }
  | { kind: 'labs' }
  | { kind: 'admin' }
  | { kind: 'admin-list'; list: AdminList }
  // 헤이젤로 가져오기 from a share link (library/ShareArrival); its key waits in common/sharePending, never in the path.
  | { kind: 'share'; id: string }
  | { kind: 'settings' };

export const HOME: Route = { kind: 'home' };
export const ADMIN_LISTS = ['accounts', 'reports', 'log'] as const;
export type AdminList = (typeof ADMIN_LISTS)[number];
// 캐릭터 둘러보기's place: a folder's id, BIN_PLACE for 휴지통, or null for the top.
export const BIN_PLACE = 'bin';
const placeOf = (params: URLSearchParams) => {
  const place = params.get('in');
  return place !== null && ID.test(place) ? place : null;
};
const placed = (path: string, place: string | null) => (place === null ? path : `${path}?in=${place}`);

type Kind<K extends Route['kind']> = Extract<Route, { kind: K }>;
export type Below = Exclude<Route, Kind<'home' | 'settings' | 'tools' | 'share'>>;

const ID = /^[0-9a-f-]{36}$/;
const POST_ID = /^[1-9][0-9]{0,14}$/;
const TO_OPERATOR = 'to=operator';
const boardQuery = ({ operator, category }: { operator: boolean; category?: Category }) =>
  operator || category ? `?${[operator && TO_OPERATOR, category && `category=${category}`].filter(Boolean).join('&')}` : '';
const NONE = 'none';
// Before the connection type ids, so a type can never take over 직접 연결's path.
const DIRECT = 'direct';

// at is a path with its query, as href writes it. Any other path is home, since the app has no page for it.
export function parseRoute(at: string): Route {
  const query = at.indexOf('?');
  const path = query < 0 ? at : at.slice(0, query);
  const params = new URLSearchParams(query < 0 ? '' : at.slice(query));
  const [top, id, sub, ...rest] = path.slice(1).split('/');
  // A model id's own slashes stay path separators: Cloudflare's asset handler redirects an escaped one (%2F) to a bare one.
  if (top === 'models' && id !== undefined && sub !== undefined) {
    const model = decoded([sub, ...rest]);
    return ID.test(id) && model ? { kind: 'model', connection: id, model } : HOME;
  }
  if (rest.length > 0) return HOME;
  if (top === 'characters') {
    if (id === undefined) {
      return { kind: 'gallery', place: params.get('in') === BIN_PLACE ? BIN_PLACE : placeOf(params) };
    }
    if (id === NONE) return sub === undefined ? { kind: 'shelf', character: null } : HOME;
    if (!ID.test(id)) return HOME;
    if (sub === undefined) return { kind: 'shelf', character: id };
    // The character's page before its editor took that place.
    if (sub === 'edit' || sub === 'about') return { kind: 'edit', character: id };
    if (sub === 'new') return { kind: 'new-chat', character: id };
    return HOME;
  }
  if (top === 's' && id !== undefined && sub === undefined) return SHARE_ID.test(id) ? { kind: 'share', id } : HOME;
  if (top === 'chats' && id !== undefined && sub === undefined) {
    if (id === 'new') return { kind: 'new-chat', character: null };
    if (ID.test(id)) return { kind: 'chat', id };
    return HOME;
  }
  if (top === 'connections') {
    if (id === undefined) return { kind: 'connections' };
    if (id !== 'new') {
      return ID.test(id) && sub === undefined ? { kind: 'connection', id } : HOME;
    }
    if (sub === undefined) return { kind: 'add-connection' };
    if (sub === DIRECT) return { kind: 'connect-direct', address: params.get('address') ?? '' };
    const type = CONNECTION_TYPES.find((candidate) => candidate.id === sub);
    return type ? { kind: 'connect', type } : HOME;
  }
  if (top === 'prompts') {
    if (id === undefined) return { kind: 'prompts', place: placeOf(params), sort: PROMPT_SORTS.find((each) => each === params.get('sort')) ?? null };
    if (!ID.test(id) || sub !== undefined) return HOME;
    const pane = params.get('pane');
    return { kind: 'prompt', id, pane: PROMPT_PANES.find((each) => each === pane) ?? null };
  }
  if (top === 'personas' && sub === undefined) {
    if (id === undefined) return { kind: 'personas', place: placeOf(params) };
    return ID.test(id) ? { kind: 'persona', id } : HOME;
  }
  if (top === 'modules') {
    if (id === undefined) return { kind: 'modules', place: placeOf(params) };
    if (!ID.test(id)) return HOME;
    // A plugin's page before 플러그인 had a page of its own.
    if (sub === 'page') return { kind: 'plugin-page', id };
    return sub === undefined ? { kind: 'module', id, pane: params.get('pane') === 'toggles' ? 'toggles' : null } : HOME;
  }
  if (top === 'plugins') {
    if (id === undefined) return { kind: 'plugins' };
    if (!ID.test(id)) return HOME;
    if (sub === 'page') return { kind: 'plugin-page', id };
    return sub === undefined ? { kind: 'plugin', id } : HOME;
  }
  if (top === 'models') {
    if (id === undefined) return { kind: 'models' };
    return ID.test(id) ? { kind: 'profile', id } : HOME;
  }
  if (id === undefined) {
    if (top === 'settings') return { kind: 'settings' };
    // 새 소식 was a section of 계정 before it became the board's 소식.
    if (top === 'account' && params.get('section') === 'news') return { kind: 'board', operator: false, category: 'news' };
    if (top === 'account') return { kind: 'account', section: ACCOUNT_SECTIONS.find((section) => section === params.get('section')) ?? null };
  }
  if (top === 'account' && id === 'usage' && sub === undefined) return { kind: 'usage' };
  if (top === 'account' && id === 'notices' && sub === undefined) return { kind: 'notices' };
  if (top === 'settings' && id === 'chat') {
    if (sub === undefined) return { kind: 'chat-settings' };
    const feature = FEATURES.find((candidate) => candidate === sub);
    return feature ? { kind: 'feature', feature } : HOME;
  }
  if (top === 'settings' && id === 'display' && sub === undefined) return { kind: 'display' };
  if (top === 'settings' && id === 'controls' && sub === undefined) return { kind: 'controls' };
  if (top === 'settings' && id === 'sounds' && sub === undefined) return { kind: 'sounds' };
  if (top === 'settings' && id === 'labs' && sub === undefined) return { kind: 'labs' };
  if (top === 'tools' && sub === undefined) {
    if (id === undefined) return { kind: 'tools' };
    if (id === 'translator') return { kind: 'translator' };
    if (id === 'calculator') return { kind: 'calculator' };
  }
  if (top === 'board') {
    const operator = params.get('to') === 'operator';
    const category = CATEGORIES.find((each) => each === params.get('category'));
    if (id === undefined) return category ? { kind: 'board', operator, category } : { kind: 'board', operator };
    if (id === 'write' && sub === undefined) return category ? { kind: 'board-write', operator, category } : { kind: 'board-write', operator };
    if (id === 'activity' && sub === undefined) return { kind: 'board-activity' };
    if (id === 'mine' && sub === undefined) return { kind: 'board-mine' };
    if (!POST_ID.test(id)) return HOME;
    if (sub === undefined) return { kind: 'post', id: Number(id) };
    return sub === 'edit' ? { kind: 'board-edit', id: Number(id) } : HOME;
  }
  if (top === 'settings' && id === 'admin') {
    if (sub === undefined) return { kind: 'admin' };
    const list = ADMIN_LISTS.find((candidate) => candidate === sub);
    return list ? { kind: 'admin-list', list } : HOME;
  }
  return HOME;
}

// A malformed escape (a stray %) names no model.
function decoded(segments: string[]): string | null {
  try {
    return segments.map(decodeURIComponent).join('/') || null;
  } catch {
    return null;
  }
}

export function href(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '/';
    case 'gallery':
      return placed('/characters', route.place);
    case 'shelf':
      return `/characters/${route.character ?? NONE}`;
    case 'edit':
      return `/characters/${route.character}/edit`;
    case 'new-chat':
      return route.character === null ? '/chats/new' : `/characters/${route.character}/new`;
    case 'chat':
      return `/chats/${route.id}`;
    case 'connections':
      return '/connections';
    case 'add-connection':
      return '/connections/new';
    case 'connect':
      return `/connections/new/${route.type.id}`;
    case 'connect-direct':
      return `/connections/new/${DIRECT}${route.address ? `?address=${encodeURIComponent(route.address)}` : ''}`;
    case 'connection':
      return `/connections/${route.id}`;
    case 'prompts':
      return route.sort ? `${placed('/prompts', route.place)}${route.place ? '&' : '?'}sort=${route.sort}` : placed('/prompts', route.place);
    case 'prompt':
      return `/prompts/${route.id}${route.pane ? `?pane=${route.pane}` : ''}`;
    case 'personas':
      return placed('/personas', route.place);
    case 'persona':
      return `/personas/${route.id}`;
    case 'modules':
      return placed('/modules', route.place);
    case 'module':
      return `/modules/${route.id}${route.pane ? `?pane=${route.pane}` : ''}`;
    case 'plugins':
      return '/plugins';
    case 'plugin':
      return `/plugins/${route.id}`;
    case 'plugin-page':
      return `/plugins/${route.id}/page`;
    case 'models':
      return '/models';
    case 'profile':
      return `/models/${route.id}`;
    case 'model':
      return `/models/${route.connection}/${route.model.split('/').map(encodeURIComponent).join('/')}`;
    case 'account':
      return `/account${route.section ? `?section=${route.section}` : ''}`;
    case 'usage':
      return '/account/usage';
    case 'notices':
      return '/account/notices';
    case 'chat-settings':
      return '/settings/chat';
    case 'feature':
      return `/settings/chat/${route.feature}`;
    case 'display':
      return '/settings/display';
    case 'controls':
      return '/settings/controls';
    case 'sounds':
      return '/settings/sounds';
    case 'tools':
      return '/tools';
    case 'translator':
      return '/tools/translator';
    case 'calculator':
      return '/tools/calculator';
    case 'board':
      return `/board${boardQuery(route)}`;
    case 'post':
      return `/board/${route.id}`;
    case 'board-write':
      return `/board/write${boardQuery(route)}`;
    case 'board-edit':
      return `/board/${route.id}/edit`;
    case 'board-activity':
      return '/board/activity';
    case 'board-mine':
      return '/board/mine';
    case 'labs':
      return '/settings/labs';
    case 'admin':
      return '/settings/admin';
    case 'admin-list':
      return `/settings/admin/${route.list}`;
    case 'share':
      return `/s/${route.id}`;
    case 'settings':
      return '/settings';
  }
}

export const sidebarPage = (route: Route) => route.kind === 'home' || route.kind === 'shelf';

// null outside API 연결's screens: every other item 설정 lists is a page of its own, never beside its list.
export function listOf(route: Route): Kind<'connections' | 'add-connection'> | null {
  switch (route.kind) {
    case 'connections':
    case 'connection':
      return { kind: 'connections' };
    case 'add-connection':
    case 'connect':
    case 'connect-direct':
      return { kind: 'add-connection' };
    default:
      return null;
  }
}

export type SettingsPage = 'models' | 'connections' | 'chat' | 'prompts' | 'personas' | 'modules' | 'plugins' | 'display' | 'controls' | 'sounds' | 'labs' | 'account' | 'admin';

// 'list' for 설정's own list, or null outside 설정. While it is not null, the settings layer stands in for the library.
export function settingsPage(route: Route): SettingsPage | 'list' | null {
  switch (route.kind) {
    case 'prompts':
    case 'prompt':
      return 'prompts';
    case 'personas':
    case 'persona':
      return 'personas';
    case 'modules':
    case 'module':
      return 'modules';
    case 'plugins':
    case 'plugin':
    case 'plugin-page':
      return 'plugins';
    case 'models':
    case 'profile':
    case 'model':
      return 'models';
    case 'account':
    case 'display':
    case 'controls':
    case 'sounds':
    case 'labs':
    case 'admin':
      return route.kind;
    case 'admin-list':
      return 'admin';
    case 'usage':
    case 'notices':
      return 'account';
    case 'chat-settings':
    case 'feature':
      return 'chat';
    case 'settings':
      return 'list';
    default:
      return listOf(route) ? 'connections' : null;
  }
}

const BOARD_KINDS: readonly Route['kind'][] = ['board', 'post', 'board-write', 'board-edit', 'board-activity', 'board-mine'];
// The rail's 게시판 stays lit on every page of the board.
export const onBoard = (route: Route) => BOARD_KINDS.includes(route.kind);

export type ToolsPage = 'translator' | 'calculator';

// 도구, a layer beside 설정 for tools apart from every chat: 'list' for its own list, or null outside it.
export function toolsPage(route: Route): ToolsPage | 'list' | null {
  switch (route.kind) {
    case 'translator':
    case 'calculator':
      return route.kind;
    case 'tools':
      return 'list';
    default:
      return null;
  }
}

// Which shelf a route is inside: a character's id, null for 캐릭터 없이, or undefined outside every
// shelf. A chat is inside its character's, which only the chat knows; undefined when it is not there.
export function shelfOf(route: Route, chatShelf?: string | null): string | null | undefined {
  switch (route.kind) {
    case 'shelf':
    case 'edit':
    case 'new-chat':
      return route.character;
    case 'chat':
      return chatShelf;
    default:
      return undefined;
  }
}

export const characterPage = (character: string, wide: boolean): Route => (wide ? { kind: 'shelf', character } : { kind: 'edit', character });

export function enterShelf(shelf: Shelf<{ id: string }>, wide: boolean): Route {
  const latest = shelf.chats[0];
  return wide && latest ? { kind: 'chat', id: latest.id } : { kind: 'shelf', character: shelf.id };
}

// On wide screens the library's pages show no 뒤로 at all (the sidebar beside them is the way back), so only phones
// use their answer.
export function up(route: Below, chatShelf?: string | null): Route {
  switch (route.kind) {
    // The route does not know a folder's parent: ← from inside one, here or on the settings lists below, goes to the
    // top; browser back goes up a level.
    case 'gallery':
      return route.place === null ? HOME : { kind: 'gallery', place: null };
    case 'shelf':
      return HOME;
    case 'edit':
    case 'new-chat':
      return { kind: 'shelf', character: route.character };
    case 'chat': {
      const shelf = shelfOf(route, chatShelf);
      return shelf === undefined ? HOME : { kind: 'shelf', character: shelf };
    }
    case 'prompts':
    case 'personas':
    case 'modules':
      if (route.place !== null) return { ...route, place: null };
    // falls through
    case 'plugins':
    case 'connections':
    case 'models':
    case 'account':
    case 'chat-settings':
    case 'display':
    case 'controls':
    case 'sounds':
    case 'labs':
    case 'admin':
      return { kind: 'settings' };
    case 'translator':
    case 'calculator':
      return { kind: 'tools' };
    case 'usage':
    case 'notices':
      return { kind: 'account', section: null };
    case 'board':
      return HOME;
    case 'post':
    case 'board-write':
    case 'board-activity':
    case 'board-mine':
      return { kind: 'board', operator: false };
    case 'board-edit':
      return { kind: 'post', id: route.id };
    case 'admin-list':
      return { kind: 'admin' };
    case 'feature':
      return { kind: 'chat-settings' };
    case 'add-connection':
    case 'connection':
      return { kind: 'connections' };
    case 'connect':
    case 'connect-direct':
      return { kind: 'add-connection' };
    case 'prompt':
      return { kind: 'prompts', place: null, sort: null };
    case 'persona':
      return { kind: 'personas', place: null };
    case 'module':
      return route.pane ? { ...route, pane: null } : { kind: 'modules', place: null };
    case 'plugin':
      return { kind: 'plugins' };
    case 'plugin-page':
      return { kind: 'plugin', id: route.id };
    case 'profile':
    case 'model':
      return { kind: 'models' };
  }
}

export type Back = { to: Route; label: string };

// 뒤로 is named for where it goes, as the layout shows that place: on phones home is the character list. Only phones
// go back to a shelf, a character's chats.
export function backTo(to: Route, wide: boolean): Back {
  switch (to.kind) {
    case 'home':
      return { to, label: wide ? '홈으로' : '목록으로' };
    case 'shelf':
      return { to, label: '채팅 목록' };
    default:
      return { to, label: '뒤로' };
  }
}
