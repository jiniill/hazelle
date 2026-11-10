import { ListChecks, ToggleLeft, ToggleRight } from 'lucide-react';
import { setPinnedTogglesSpread } from '../../runtime/library/characters';
import { ToggleFlip, type FlippedToggle } from '../common/ToggleChoice';
import { useSettings, useStore } from '../session';
import { ChoiceGroup, Menu, MenuItem, SettingRow, Stack, ToolButton } from '../ui';
import type { OpenChat } from './useChat';

type Toggles = OpenChat['toggles'];
type Flip = OpenChat['actions']['flip'];
type Pin = { toggle: FlippedToggle; value: string };

// 입력창에 고정: the pinned toggles this chat declares, in pin order. A text toggle is never pinned (ChatToggles).
function usePins(toggles: Toggles): Pin[] {
  const pinned = useSettings().pinnedToggles ?? [];
  const rows = new Map(toggles.sections.flatMap((section) => section.rows).map((row) => [row.toggle.key, row]));
  return pinned.flatMap((key) => {
    const row = rows.get(key);
    return row && row.toggle.kind !== 'text' ? [{ toggle: row.toggle, value: row.value }] : [];
  });
}

export function ChatPinnedToggles({ toggles, onFlip }: { toggles: Toggles; onFlip: Flip }) {
  const { pinnedTogglesSpread } = useSettings();
  const pins = usePins(toggles);
  if (!pins.length) return null;
  if (pinnedTogglesSpread) return pins.map((pin) => <SpreadPin key={pin.toggle.key} pin={pin} onFlip={onFlip} />);
  const on = pins.filter(({ toggle, value }) => toggle.kind === 'check' && value === '1').length;
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="고정한 토글"
      trigger={(opener) => <ToolButton icon={ListChecks} label={`토글 ${pins.length}개`} detail={on ? `${on}개 켜짐` : undefined} {...opener} />}
    >
      <Stack gap="related">
        {pins.map(({ toggle, value }) => <SettingRow key={toggle.key} label={toggle.label} control={<ToggleFlip toggle={toggle} value={value} opens="up" onFlip={onFlip} />} />)}
      </Stack>
    </Menu>
  );
}

function SpreadPin({ pin: { toggle, value }, onFlip }: { pin: Pin; onFlip: Flip }) {
  if (toggle.kind === 'check') {
    const on = value === '1';
    return <ToolButton icon={on ? ToggleRight : ToggleLeft} label={`${toggle.label} · ${on ? '켜짐' : '꺼짐'}`} onClick={() => onFlip(toggle.key, on ? '0' : '1')} />;
  }
  return (
    <Menu place="above-start" label={toggle.label} trigger={(opener) => <ToolButton icon={ListChecks} label={`${toggle.label} · ${toggle.options[Number(value)] ?? value}`} {...opener} />}>
      {toggle.options.map((option, index) => (
        <MenuItem key={index} label={option} checked={String(index) === value} onClick={() => onFlip(toggle.key, String(index))} />
      ))}
    </Menu>
  );
}

// Lives in ⋯, not in the chip's panel: spreading removes the chip and its panel, and with them the way back.
export function PinnedTogglesLayout({ toggles }: { toggles: Toggles }) {
  const store = useStore();
  const { pinnedTogglesSpread } = useSettings();
  if (!usePins(toggles).length) return null;
  return (
    <SettingRow
      label="고정한 토글"
      control={
        <ChoiceGroup
          label="고정한 토글"
          layout="fit"
          options={[{ value: 'gathered', label: '모아 놓기' }, { value: 'spread', label: '펼쳐 놓기' }]}
          value={pinnedTogglesSpread ? 'spread' : 'gathered'}
          onChange={(to) => void setPinnedTogglesSpread(store, to === 'spread')}
        />
      }
    />
  );
}
