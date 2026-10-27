import { FileText, FlaskConical, Hand, Layers, Lock, MessageSquare, Package, Plug, Puzzle, ShieldCheck, SunMoon, User, Volume2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useSearch } from '../../common/useSearch';
import { PAGES, SETTINGS } from '../../common/words';
import { presetOf } from '../../common/reading';
import { useDisplay } from '../../display';
import { useAccount, useConnections, useModulesAndPlugins, usePersonas, usePrompts, useSession, useSettings } from '../../session';
import { Empty, LayerSidebar, List, ListItem, NavBar, NavGroup, NavRow, Screen } from '../../ui';
import { navigate } from '../router';
import type { Route, SettingsPage } from '../routes';
import { subpages, TERMS } from './terms';

type Place = { page: SettingsPage; label: string; icon: LucideIcon; route: Route };
type Group = { title: string; places: Place[] };

// List built pages only; group headings cannot repeat child labels. Keep app/account in the separated footer group.
const GROUPS: Group[] = [
  {
    title: 'AI 엔진',
    places: [
      { page: 'models', label: PAGES.models, icon: Layers, route: { kind: 'models' } },
      { page: 'connections', label: PAGES.connections, icon: Plug, route: { kind: 'connections' } },
    ],
  },
  {
    title: '롤플레이',
    places: [
      { page: 'chat', label: PAGES.chat, icon: MessageSquare, route: { kind: 'chat-settings' } },
      { page: 'prompts', label: PAGES.prompts, icon: FileText, route: { kind: 'prompts', place: null, sort: null } },
      { page: 'personas', label: PAGES.personas, icon: User, route: { kind: 'personas', place: null } },
      { page: 'modules', label: PAGES.modules, icon: Package, route: { kind: 'modules', place: null } },
      { page: 'plugins', label: PAGES.plugins, icon: Puzzle, route: { kind: 'plugins' } },
    ],
  },
];
const APP_TITLE = '앱';
const APP: Place[] = [
  { page: 'display', label: PAGES.display, icon: SunMoon, route: { kind: 'display' } },
  { page: 'controls', label: PAGES.controls, icon: Hand, route: { kind: 'controls' } },
  { page: 'sounds', label: PAGES.sounds, icon: Volume2, route: { kind: 'sounds' } },
  { page: 'labs', label: PAGES.labs, icon: FlaskConical, route: { kind: 'labs' } },
  { page: 'account', label: PAGES.account, icon: Lock, route: { kind: 'account', section: null } },
];
const ADMIN: Place = { page: 'admin', label: PAGES.admin, icon: ShieldCheck, route: { kind: 'admin' } };

function useApp(): Place[] {
  const { admin } = useAccount();
  return admin ? [...APP, ADMIN] : APP;
}

// What each page holds, at its row's end in the sidebar and the phone list.
function useHolds(): Record<SettingsPage, string | undefined> {
  const prompts = usePrompts();
  const personas = usePersonas();
  const { modules, plugins } = useModulesAndPlugins();
  const connections = useConnections();
  const { username } = useSession();
  const { reading, display, presets } = useDisplay();
  return {
    models: `${connections.reduce((sum, connection) => sum + connection.value.starred.length, 0)}개`,
    connections: `${connections.length}개`,
    chat: undefined,
    prompts: `${prompts.length}개`,
    personas: `${personas.length}개`,
    modules: `${modules.length}개`,
    plugins: `${plugins.length}개`,
    display: presetOf(presets, reading, display)?.name,
    controls: undefined,
    sounds: undefined,
    labs: undefined,
    account: username,
    admin: undefined,
  };
}

// where: the page that holds the term, unless the term is that page's own label.
type Hit = { term: string; place: Place; where: string | undefined; to: Route };

// 설정 검색: a page by its label, or by a title or label shown on it; a hit opens the page and clears the words.
function useSettingsSearch(places: Place[]) {
  const query = useState('');
  const subs = subpages(useSettings());
  const hits: Hit[] = places.flatMap((place) => [
    ...[place.label, ...TERMS[place.page]].map((term) => ({ term, place, where: term === place.label ? undefined : place.label, to: place.route })),
    ...(subs[place.page] ?? []).flatMap((sub) =>
      [sub.label, ...sub.terms].map((term) => ({ term, place, where: term === sub.label ? place.label : `${place.label} › ${sub.label}`, to: sub.route })),
    ),
  ]);
  const open = (hit: Hit) => {
    query[1]('');
    navigate(hit.to);
  };
  return { ...useSearch(hits, '설정 검색', ({ term }) => [term], { query, onEnter: open }), open };
}

// Where the library's 설정 lands: the first page where the sidebar lists them all, the list on phones.
export const settingsEntry = (wide: boolean): Route => (wide ? GROUPS[0]!.places[0]!.route : { kind: 'settings' });

export function SettingsSidebar({ current, onClose }: { current: SettingsPage | 'list'; onClose: () => void }) {
  const app = useApp();
  const holds = useHolds();
  const search = useSettingsSearch([...GROUPS.flatMap(({ places }) => places), ...app]);
  const row = (place: Place) => <NavRow key={place.page} icon={place.icon} label={place.label} meta={holds[place.page]} current={place.page === current} onClick={() => navigate(place.route)} />;
  return (
    <LayerSidebar title={SETTINGS} onClose={onClose} search={search.field} footer={search.words ? null : <NavGroup title={APP_TITLE}>{app.map(row)}</NavGroup>}>
      {search.words ? (
        search.none ? (
          <Empty variant="side">{search.none}</Empty>
        ) : (
          search.found.map((hit) => <NavRow key={`${hit.where}/${hit.term}`} icon={hit.place.icon} label={hit.term} meta={hit.where} onClick={() => search.open(hit)} />)
        )
      ) : (
        GROUPS.map(({ title, places }) => (
          <NavGroup key={title} title={title}>
            {places.map(row)}
          </NavGroup>
        ))
      )}
    </LayerSidebar>
  );
}

export function SettingsList({ onClose }: { onClose: () => void }) {
  const holds = useHolds();
  const app = useApp();
  const groups = [...GROUPS, { title: APP_TITLE, places: app }];
  const search = useSettingsSearch(groups.flatMap(({ places }) => places));
  return (
    <Screen top={<NavBar title={SETTINGS} close backLabel={`${SETTINGS} 닫기`} onBack={onClose} />}>
      {search.field}
      {search.words ? (
        search.none ? (
          <Empty variant="section">{search.none}</Empty>
        ) : (
          <List places label="설정 검색 결과">
            {search.found.map((hit) => (
              <ListItem key={`${hit.where}/${hit.term}`} title={hit.term} note={hit.where} onClick={() => search.open(hit)} />
            ))}
          </List>
        )
      ) : (
        groups.map(({ title, places }) => (
          <NavGroup key={title} title={title}>
            <List places label={title}>
              {places.map((place) => (
                <ListItem key={place.page} title={place.label} note={holds[place.page]} onClick={() => navigate(place.route)} />
              ))}
            </List>
          </NavGroup>
        ))
      )}
    </Screen>
  );
}
