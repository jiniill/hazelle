import { Layers, Pin } from 'lucide-react';
import { refOf, sameModelRef, type ModelRef } from '../../connectors/assignment';
import { recentModels } from '../../model/chat';
import { entryName, entryOf } from '../../connectors/types';
import type { Route, RouteFailure } from '../../runtime/models/assignment';
import { modelProfile } from '../../runtime/models/profiles';
import { ModelChoices } from './ModelChoices';
import { starredModels } from './RolePicker';
import { profileLine } from './settingWords';
import { MODEL_PINNED, MODEL_SETTINGS, PICK_MODEL } from './words';
import { useCaptured, useSummaries, useConnections, useSettings } from '../session';
import { navigate } from '../shell/router';
import { ChipButton, Divider, Icon, Menu, MenuItem, Tag, type MenuHandle } from '../ui';

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
      <RecentFirst current={current} onPick={onPick} />
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

// Its own component, so the chats' recent models are read only while the menu is open.
function RecentFirst({ current, onPick }: Pick<Props, 'current' | 'onPick'>) {
  const routes = starredModels(useConnections(), 'main');
  const recent = recentModels(
    useSummaries().map(({ value }) => value.recent),
    RECENT,
  ).flatMap((ref) => routes.filter((route) => sameModelRef(refOf(route.connection.id, route.model), ref)));
  return <ModelChoices routes={routes} recent={recent} current={current} onPick={onPick} />;
}
