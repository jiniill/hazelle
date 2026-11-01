import { ListChecks } from 'lucide-react';
import { ToggleFlip, type FlippedToggle } from '../common/ToggleChoice';
import { useSettings } from '../session';
import { Menu, SettingRow, Stack, ToolButton } from '../ui';
import type { OpenChat } from './useChat';

// 입력창에 고정: the pinned toggles this chat declares, in pin order, behind one button. A text toggle is never pinned (ChatToggles).
type Props = { toggles: OpenChat['toggles']; onFlip: OpenChat['actions']['flip'] };

export function ChatPinnedToggles({ toggles, onFlip }: Props) {
  const pinned = useSettings().pinnedToggles ?? [];
  const rows = new Map(toggles.sections.flatMap((section) => section.rows).map((row) => [row.toggle.key, row]));
  const shown = pinned.flatMap((key): { toggle: FlippedToggle; value: string }[] => {
    const row = rows.get(key);
    return row && row.toggle.kind !== 'text' ? [{ toggle: row.toggle, value: row.value }] : [];
  });
  if (!shown.length) return null;
  const on = shown.filter(({ toggle, value }) => toggle.kind === 'check' && value === '1').length;
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="고정한 토글"
      trigger={(opener) => <ToolButton icon={ListChecks} label={`토글 ${shown.length}개`} detail={on ? `${on}개 켜짐` : undefined} {...opener} />}
    >
      <Stack gap="related">
        {shown.map(({ toggle, value }) => <SettingRow key={toggle.key} label={toggle.label} control={<ToggleFlip toggle={toggle} value={value} opens="up" onFlip={onFlip} />} />)}
      </Stack>
    </Menu>
  );
}
