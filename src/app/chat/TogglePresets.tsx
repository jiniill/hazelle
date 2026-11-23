import type { ReactNode } from 'react';
import type { TogglePreset, ToggleValues } from '../../model/prompt';
import { presetHolds } from '../../model/toggles';
import type { ApiFailure, ApiResult } from '../../runtime/api';
import { togglePresets } from '../../runtime/library/toggle-presets';
import { PresetList } from '../common/PresetList';
import { usePresetActs } from '../common/usePresetActs';
import { PRESET } from '../common/words';
import { useStore } from '../session';
import { Button, Menu, useMenuClose } from '../ui';
import type { ToggleSection } from './toggles';

type Props = { section: ToggleSection; onPick: (preset: TogglePreset) => void; now: () => Promise<ApiResult<ToggleValues>>; onEdit: () => void };

// A toggle section's presets, in its head: picked from the list, saved from the values shown now. Its declared
// defaults are changed from here too, in the editor of the one that declares them.
export function TogglePresets({ section, onPick, now, onEdit }: Props) {
  const presets = togglePresets(useStore(), section);
  const current = section.presets.find(({ values }) => presetHolds(section.rows, values)) ?? null;
  const label = `${section.name} ${PRESET.noun}`;

  async function withNow(write: (values: ToggleValues) => Promise<{ ok: true } | ApiFailure>) {
    const read = await now();
    return read.ok ? write(read.data) : read;
  }

  const acts = usePresetActs({
    count: section.presets.length,
    current,
    keep: { add: (name) => withNow((values) => presets.add({ id: crypto.randomUUID(), name, values })), over: ({ id }) => withNow((values) => presets.edit(id, { values })) },
    rename: ({ id }: TogglePreset, name) => presets.edit(id, { name }),
    remove: ({ id }) => presets.remove(id),
    restore: presets.restore,
  });

  return (
    <>
      <Menu
        label={label}
        kind="dialog"
        place="below-end"
        trigger={(opener) => (
          <Button variant="link" {...opener}>
            {PRESET.noun}
          </Button>
        )}
      >
        <Closing>
          {(then) => (
            <>
              <PresetList label={label} presets={section.presets} current={current} onPick={(preset) => then(() => onPick(preset))} menu={acts.items} />
              {!current && (
                <Button variant="secondary" onClick={() => then(acts.save!)}>
                  {PRESET.save}
                </Button>
              )}
              <Button variant="link" onClick={() => then(onEdit)}>
                기본값 바꾸기
              </Button>
            </>
          )}
        </Closing>
      </Menu>
      {acts.dialog}
    </>
  );
}

// Inside the menu, where its close is read: an act that leaves it closes it first.
function Closing({ children }: { children: (then: (act: () => void) => void) => ReactNode }) {
  const close = useMenuClose();
  return children((act) => {
    close();
    act();
  });
}
