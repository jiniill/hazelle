import type { ReactNode } from 'react';
import { Empty, List, ListItem, MoreMenu } from '../ui';

type Props<P> = {
  label: string;
  presets: readonly P[];
  current: P | null | undefined;
  // error: why it cannot be picked now, said in place of what it holds.
  words?: (preset: P) => { description: string } | { error: string };
  onPick: (preset: P) => void;
  menu: (preset: P) => ReactNode;
};

// The user's own presets as rows: the current one checked, a press picks, each with its ⋯ (common/usePresetActs).
export function PresetList<P extends { id: string; name: string }>({ label, presets, current, words, onPick, menu }: Props<P>) {
  if (presets.length === 0) return <Empty variant="menu">저장한 프리셋이 없어요.</Empty>;
  return (
    <List label={label}>
      {presets.map((preset) => {
        const said = words?.(preset);
        const why = said && 'error' in said ? said.error : undefined;
        return <ListItem key={preset.id} title={preset.name} description={why ?? (said && 'description' in said ? said.description : undefined)} error={why} selected={preset === current} onClick={why ? undefined : () => onPick(preset)} control={<MoreMenu of={preset.name}>{menu(preset)}</MoreMenu>} />;
      })}
    </List>
  );
}
