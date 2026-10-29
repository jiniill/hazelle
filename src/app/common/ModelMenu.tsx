import { Layers } from 'lucide-react';
import { refOf, sameModelRef, type ModelRef } from '../../connectors/assignment';
import { recentModels } from '../../model/chat';
import { entryName, entryOf, entryTerms } from '../../connectors/types';
import type { Route, RouteFailure } from '../../runtime/assignment';
import { modelProfile } from '../../runtime/profiles';
import { byConnection, starredModels } from './RolePicker';
import { profileLine } from './settingWords';
import { useSearch } from './useSearch';
import { MODEL_SETTINGS, noStarred } from './words';
import { useSummaries, useConnections, useSettings, useStore } from '../session';
import { navigate } from '../shell/router';
import { ChipButton, Divider, Empty, Icon, Menu, MenuHeading, MenuItem, type MenuHandle } from '../ui';

type Props = {
  current: ModelRef | null;
  onPick: (ref: ModelRef) => void;
  handle?: MenuHandle;
};

const RECENT = 3;

// Added models only, recent ones first. It never lists providers.
export function ModelMenu({ route, onPick, handle }: Pick<Props, 'onPick' | 'handle'> & { route: Route | RouteFailure }) {
  const current = 'kind' in route ? null : refOf(route.connection.id, route.model);
  const label = 'kind' in route ? '모델 선택' : entryName(route.model);
  return (
    <Menu handle={handle} place="below-end" size="lg" label="모델" trigger={(opener) => <ChipButton label={label} title="모델 바꾸기" leading={<Icon icon={Layers} size="sm" />} phone="icon" {...opener} />}>
      <ModelChoices current={current} onPick={onPick} />
      <Divider variant="menu" />
      {current && <ProfileItem current={current} />}
      <MenuItem tone="muted" label="추가한 모델 관리" onClick={() => navigate({ kind: 'connections' })} />
    </Menu>
  );
}

function ProfileItem({ current }: { current: ModelRef }) {
  const store = useStore();
  const connections = useConnections();
  const settings = useSettings();
  const connection = connections.find(({ id }) => id === current.connection);
  const model = connection && entryOf(connection.value, current.model);
  if (!model) return null;
  const choice = modelProfile(store, model);
  return <MenuItem tone="muted" label={MODEL_SETTINGS} sub={choice.kind === 'profile' ? profileLine(choice, settings.profile) : '없음'} onClick={() => navigate({ kind: 'model', ...current })} />;
}

// Mounted only while the menu is open, so each opening starts with an empty search.
function ModelChoices({ current, onPick }: Pick<Props, 'current' | 'onPick'>) {
  const connections = useConnections();
  const summaries = useSummaries();
  const starred = starredModels(connections, 'main');
  const recent = recentModels(
    summaries.map(({ value }) => value.recent),
    RECENT,
  ).flatMap((ref) => starred.filter((choice) => sameModelRef(choice.ref, ref)));
  const rest = starred.filter((choice) => !recent.includes(choice));
  const search = useSearch(starred, '추가한 모델 검색', (choice) => [...entryTerms(choice.model), choice.source]);

  // Recent models and search results mix connections, so each names its own; the rest sit under connection headings.
  const item = (choice: (typeof starred)[number], sub?: string) => (
    <MenuItem key={`${choice.ref.connection}/${choice.ref.model}`} label={choice.name} sub={sub} checked={!!current && sameModelRef(choice.ref, current)} onClick={() => onPick(choice.ref)} />
  );

  if (starred.length === 0) return <Empty variant="menu">{noStarred('선택할 수 있어요')}</Empty>;
  return (
    <>
      {search.field}
      {search.words ? (
        search.none ? (
          <Empty variant="menu">{search.none}</Empty>
        ) : (
          <>
            <MenuHeading>검색 결과</MenuHeading>
            {search.found.map((choice) => item(choice, choice.source))}
          </>
        )
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <MenuHeading>최근</MenuHeading>
              {recent.map((choice) => item(choice, choice.source))}
            </>
          )}
          {byConnection(rest, (choice) => item(choice))}
        </>
      )}
    </>
  );
}
