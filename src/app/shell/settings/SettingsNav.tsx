import { FileText, FlaskConical, Hand, Layers, Lock, MessageSquare, Network, Package, Plug, Puzzle, ShieldCheck, SunMoon, User, Volume2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { litIn } from '../../common/search';
import { useSearch } from '../../common/useSearch';
import { FEATURE_ICONS } from '../../common/featureIcons';
import { FEATURE_NAMES, FEATURES_TITLE, onOff, PAGES, SETTINGS, TOOLS, LAB, SEARCH_RESULTS, searchOf } from '../../common/words';
import { presetOf } from '../../common/reading';
import { useDisplay } from '../../display';
import { FEATURE_LABS, FEATURES, type Feature } from '../../../model/features';
import { availableFeatures, sharedFeatures } from '../../../runtime/tasks/features';
import { overviewOf } from '../../../runtime/tasks/overview';
import { useAccount, useCaptured, useConnections, useModulesAndPlugins, usePersonas, useProfiles, usePrompts, useSession, useSettings, useStore } from '../../session';
import { Empty, FoundRow, Icon, LayerSidebar, List, ListItem, NavBar, NavGroup, NavRow, Screen, seekRow, THEMES } from '../../ui';
import { failingOf } from '../../settings/setup';
import { navigate } from '../router';
import type { Route, SettingsPage, ToolsPage } from '../routes';
import { TOOL_PLACES } from '../tools/ToolsNav';
import { hitsOf, hitTexts, subpages, type Hit } from './terms';

type Place = { page: SettingsPage; label: string; icon: LucideIcon; route: Route };
// Untitled: a place that stands apart from every set, such as 내 구성 at the top.
type Group = { title?: string; places: Place[] };

const SETUP: Group = { places: [{ page: 'setup', label: PAGES.setup, icon: Network, route: { kind: 'setup' } }] };
// List built pages only; group headings cannot repeat child labels. A connection comes before the models it adds.
const AI: Group = {
  title: 'AI 엔진',
  places: [
    { page: 'connections', label: PAGES.connections, icon: Plug, route: { kind: 'connections' } },
    { page: 'models', label: PAGES.models, icon: Layers, route: { kind: 'models' } },
  ],
};
// What the person has the app do: 대화, then each feature 실험실 leaves on.
const doing = (features: readonly Feature[]): Group => ({
  title: FEATURES_TITLE,
  places: [
    { page: 'chat', label: PAGES.chat, icon: MessageSquare, route: { kind: 'chat-settings' } },
    ...features.map((feature) => ({ page: feature, label: FEATURE_NAMES[feature], icon: FEATURE_ICONS[feature], route: { kind: 'feature', feature } as const })),
  ],
});
// What the person has, which the features use.
const HAVE: Group = {
  title: '구성 요소',
  places: [
    { page: 'prompts', label: PAGES.prompts, icon: FileText, route: { kind: 'prompts', place: null, sort: null } },
    { page: 'personas', label: PAGES.personas, icon: User, route: { kind: 'personas', place: null } },
    { page: 'modules', label: PAGES.modules, icon: Package, route: { kind: 'modules', place: null } },
    { page: 'plugins', label: PAGES.plugins, icon: Puzzle, route: { kind: 'plugins' } },
  ],
};
const APP: Place[] = [
  { page: 'display', label: PAGES.display, icon: SunMoon, route: { kind: 'display' } },
  { page: 'controls', label: PAGES.controls, icon: Hand, route: { kind: 'controls' } },
  { page: 'sounds', label: PAGES.sounds, icon: Volume2, route: { kind: 'sounds' } },
  { page: 'labs', label: PAGES.labs, icon: FlaskConical, route: { kind: 'labs' } },
  { page: 'account', label: PAGES.account, icon: Lock, route: { kind: 'account', section: null } },
];
const ADMIN: Place = { page: 'admin', label: PAGES.admin, icon: ShieldCheck, route: { kind: 'admin' } };
// 설정 검색 finds 도구's pages too, under the window that holds them.
type Sought = { page: SettingsPage | ToolsPage; label: string; icon: LucideIcon; route: Route; where?: string };
const TOOLS_SOUGHT: Sought[] = TOOL_PLACES.map((place) => ({ ...place, where: TOOLS }));

function useSettingsNav() {
  const { admin } = useAccount();
  const available = availableFeatures(useSettings());
  const groups: Group[] = [SETUP, AI, doing(available), HAVE, { title: '앱', places: admin ? [...APP, ADMIN] : APP }];
  // 대화 and the features that are on in 공용 and cannot run now, each marked in its row with why.
  const fails: Partial<Record<SettingsPage, string>> = failingOf(
    useCaptured((store) => overviewOf(store, null), []),
    available,
  );
  return { groups, holds: useHolds(), fails, search: useSettingsSearch([...groups.flatMap(({ places }): Sought[] => places), ...TOOLS_SOUGHT]) };
}

// What each page holds, at its row's end in the sidebar and the phone list: a feature, whether chats use it.
function useHolds(): Record<SettingsPage, string | undefined> {
  const store = useStore();
  const prompts = usePrompts();
  const personas = usePersonas();
  const { modules, plugins } = useModulesAndPlugins();
  const connections = useConnections();
  const { username } = useSession();
  const { reading, display, presets } = useDisplay();
  // Subscribed for sharedFeatures, which reads the settings from the store.
  useSettings();
  const used = sharedFeatures(store);
  const state = (feature: Feature) => [FEATURE_LABS[feature] && LAB, onOff(used[feature])].filter(Boolean).join(' · ');
  return {
    setup: undefined,
    models: `${connections.reduce((sum, connection) => sum + connection.value.starred.length, 0)}개`,
    connections: `${connections.length}개`,
    chat: undefined,
    ...(Object.fromEntries(FEATURES.map((feature) => [feature, state(feature)])) as Record<Feature, string>),
    prompts: `${prompts.length}개`,
    personas: `${personas.length}개`,
    modules: `${modules.length}개`,
    plugins: `${plugins.length}개`,
    theme: THEMES[display.theme].name,
    display: presetOf(presets, reading, display)?.name,
    controls: undefined,
    sounds: undefined,
    labs: undefined,
    account: username,
    admin: undefined,
  };
}

// 설정 검색: a page by its label, or by a title or label shown on it; a hit opens the page at that row and clears the words.
function useSettingsSearch(places: Sought[]) {
  const query = useState('');
  const hits = hitsOf(places, subpages(useSettings(), useProfiles()));
  const open = (hit: Hit<Sought>) => {
    query[1]('');
    navigate(hit.to);
    if (hit.seek) seekRow(hit.seek);
  };
  return { ...useSearch(hits, searchOf(SETTINGS), hitTexts, { query, onEnter: open }), open };
}

// Each hit as where it stands, the words typed lit in the label they were found in.
function Hits({ search }: { search: ReturnType<typeof useSettingsSearch> }) {
  return (
    <List label={`${SETTINGS} ${SEARCH_RESULTS}`}>
      {search.found.map((hit) => (
        <FoundRow key={`${hit.where}/${hit.term}`} face={<Icon icon={hit.place.icon} size="sm" />} path={[...hit.where, litIn(hit.term, search.words)]} snippet={null} onClick={() => search.open(hit)} />
      ))}
    </List>
  );
}

// Where the library's 설정 lands: 모델 where the sidebar lists them all (design §2), the list on phones.
export const settingsEntry = (wide: boolean): Route => (wide ? { kind: 'models' } : { kind: 'settings' });

export function SettingsSidebar({ current, onClose }: { current: SettingsPage | 'list'; onClose: () => void }) {
  const { groups, holds, fails, search } = useSettingsNav();
  return (
    <LayerSidebar title={SETTINGS} onClose={onClose} search={search.field} seek={search.words ? undefined : current}>
      {search.words ? (
        search.none ? (
          <Empty variant="side">{search.none}</Empty>
        ) : (
          <Hits search={search} />
        )
      ) : (
        groups.map(({ title, places }) => (
          <NavGroup key={title ?? places[0]!.page} title={title}>
            {places.map((place) => (
              <NavRow key={place.page} icon={place.icon} label={place.label} note={holds[place.page]} error={fails[place.page]} current={place.page === current} onClick={() => navigate(place.route, { replace: true })} />
            ))}
          </NavGroup>
        ))
      )}
    </LayerSidebar>
  );
}

export function SettingsList({ onClose }: { onClose: () => void }) {
  const { groups, holds, fails, search } = useSettingsNav();
  return (
    <Screen top={<NavBar title={SETTINGS} close backLabel={`${SETTINGS} 닫기`} onBack={onClose} />}>
      {search.field}
      {search.words ? (
        search.none ? (
          <Empty variant="section">{search.none}</Empty>
        ) : (
          <Hits search={search} />
        )
      ) : (
        groups.map(({ title, places }) => (
          <NavGroup key={title ?? places[0]!.page} title={title}>
            <List places label={title ?? SETTINGS}>
              {places.map((place) => (
                <ListItem key={place.page} title={place.label} note={holds[place.page]} error={fails[place.page]} onClick={() => navigate(place.route)} />
              ))}
            </List>
          </NavGroup>
        ))
      )}
    </Screen>
  );
}
