import { Layers, Pin } from 'lucide-react';
import { refOf, sameModelRef, type ModelRef } from '../../connectors/assignment';
import { recentModels } from '../../model/chat';
import { entryName, entryOf, entryTerms } from '../../connectors/types';
import type { Route, RouteFailure } from '../../runtime/models/assignment';
import { modelProfile } from '../../runtime/models/profiles';
import { byConnection, starredModels } from './RolePicker';
import { profileLine } from './settingWords';
import { useSearch } from './useSearch';
import { MODEL_PINNED, MODEL_SETTINGS, noStarred, SEARCH_RESULTS, searchOf, STARRED, PICK_MODEL } from './words';
import { useCaptured, useSummaries, useConnections, useSettings } from '../session';
import { navigate } from '../shell/router';
import { ChipButton, Divider, Empty, Icon, Menu, MenuHeading, MenuItem, Tag, type MenuHandle } from '../ui';

type Props = {
  current: ModelRef | null;
  onPick: (ref: ModelRef) => void;
  handle?: MenuHandle;
};

const RECENT = 3;

// Added models only, recent ones first. It never lists providers. pin: the prompt whose own model the chat talks on
// (runtime/models/assignment pinnedBy), marked on the button and opened from the menu's head.
// place: the side it opens to, for a button at a screen's foot.
export function ModelMenu({ route, pin, onPick, handle, place = 'below-end' }: Pick<Props, 'onPick' | 'handle'> & { route: Route | RouteFailure; pin?: { name: string; open: () => void } | null; place?: 'below-end' | 'above-end' }) {
  const current = 'kind' in route ? null : refOf(route.connection.id, route.model);
  const label = 'kind' in route ? PICK_MODEL : entryName(route.model);
  return (
    <Menu
      handle={handle}
      place={place}
      size="lg"
      label="모델"
      trigger={(opener) => <ChipButton label={label} title={pin ? `모델 바꾸기 · ${MODEL_PINNED}` : '모델 바꾸기'} leading={<Icon icon={pin ? Pin : Layers} size="sm" />} phone="icon" {...opener} />}
    >
      {pin && (
        <>
          <MenuItem tone="muted" label={pin.name} description="이 프롬프트가 지정한 모델이에요. 여기서 바꾸면 이 채팅에만 적용돼요." tag={<Tag>{MODEL_PINNED}</Tag>} onClick={pin.open} />
          <Divider variant="menu" />
        </>
      )}
      <ModelChoices current={current} onPick={onPick} />
      <Divider variant="menu" />
      {current && <ProfileItem current={current} />}
      <MenuItem tone="muted" label="추가한 모델 관리" onClick={() => navigate({ kind: 'connections' })} />
    </Menu>
  );
}

function ProfileItem({ current }: { current: ModelRef }) {
  const connections = useConnections();
  const settings = useSettings();
  const connection = connections.find(({ id }) => id === current.connection);
  const model = connection && entryOf(connection.value, current.model);
  const choice = useCaptured((store) => (model ? modelProfile(store, model) : null), [model]);
  if (!model || !choice) return null;
  return <MenuItem tone="muted" label={MODEL_SETTINGS} description={choice.kind === 'profile' ? profileLine(choice, settings.profile) : '없음'} onClick={() => navigate({ kind: 'model', ...current })} />;
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
  const search = useSearch(starred, searchOf(STARRED), (choice) => [...entryTerms(choice.model), choice.source]);

  // Recent models and search results mix connections, so each names its own; the rest sit under connection headings.
  const item = (choice: (typeof starred)[number], sub?: string) => (
    <MenuItem key={`${choice.ref.connection}/${choice.ref.model}`} label={choice.name} description={sub} checked={!!current && sameModelRef(choice.ref, current)} onClick={() => onPick(choice.ref)} />
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
            <MenuHeading>{SEARCH_RESULTS}</MenuHeading>
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
