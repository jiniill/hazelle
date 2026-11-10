import { useState, type ReactNode } from 'react';
import type { TogglePreset, ToggleValues } from '../../model/prompt';
import type { ApiResult } from '../../runtime/api';
import { addTogglePreset, editTogglePreset, removeTogglePreset, restoreTogglePreset } from '../../runtime/library/toggle-presets';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { useRemoval } from '../common/useRemoval';
import { PRESET, SAVE_FAILED } from '../common/words';
import { useStore } from '../session';
import { useToast } from '../toast';
import { Button, Empty, List, ListItem, Menu, MenuItem, MoreMenu, useMenuClose } from '../ui';
import { currentPreset, type ToggleSection } from './toggles';

type Props = { section: ToggleSection; onPick: (preset: TogglePreset) => void; now: () => Promise<ApiResult<ToggleValues>>; onEdit: () => void };

// A toggle section's presets, in its head: picked from the list, saved from the values shown now. Its declared
// defaults are changed from here too, in the editor of the one that declares them.
export function TogglePresets({ section, onPick, now, onEdit }: Props) {
  const store = useStore();
  const toast = useToast();
  const removal = useRemoval();
  const [naming, setNaming] = useState<{ preset: TogglePreset | null } | null>(null);
  const owner = { from: section.from, id: section.id };
  const current = currentPreset(section);

  async function withNow(write: (values: ToggleValues) => Promise<ApiResult<unknown>>) {
    const read = await now();
    toast.settled(read.ok ? write(read.data) : Promise.resolve(read), SAVE_FAILED);
  }

  function name(typed: string) {
    const preset = naming?.preset;
    setNaming(null);
    if (preset) return toast.settled(editTogglePreset(store, owner, preset.id, { name: typed }), SAVE_FAILED);
    void withNow((values) => addTogglePreset(store, owner, { id: crypto.randomUUID(), name: typed, values }));
  }

  const remove = ({ id, name }: TogglePreset) => removal({ name: () => name, noun: PRESET.noun, task: () => removeTogglePreset(store, owner, id), restore: (removed) => restoreTogglePreset(store, owner, removed) });

  return (
    <>
      <Menu
        label={`${section.name} ${PRESET.noun}`}
        kind="dialog"
        place="below-end"
        trigger={(opener) => (
          <Button variant="link" {...opener}>
            {PRESET.noun}
          </Button>
        )}
      >
        <Presets
          section={section}
          current={current}
          onPick={onPick}
          onSave={() => setNaming({ preset: null })}
          onEdit={onEdit}
          menu={(preset) => (
            <MoreMenu of={preset.name}>
              <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming({ preset })} />
              {preset !== current && <MenuItem icon={ACTS.overwrite.icon} label={ACTS.overwrite.label} onClick={() => void withNow((values) => editTogglePreset(store, owner, preset.id, { values }))} />}
              <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void remove(preset)} />
            </MoreMenu>
          )}
        />
      </Menu>
      {naming && (
        <NameDialog
          title={naming.preset ? PRESET.rename : PRESET.save}
          value={naming.preset?.name ?? PRESET.named(section.presets.length)}
          onSave={name}
          onClose={() => setNaming(null)}
        />
      )}
    </>
  );
}

type PresetsProps = { section: ToggleSection; current: TogglePreset | null; onPick: (preset: TogglePreset) => void; onSave: () => void; onEdit: () => void; menu: (preset: TogglePreset) => ReactNode };

function Presets({ section, current, onPick, onSave, onEdit, menu }: PresetsProps) {
  const close = useMenuClose();
  const then = (act: () => void) => () => {
    close();
    act();
  };
  return (
    <>
      {section.presets.length === 0 ? (
        <Empty variant="menu">저장한 프리셋이 없어요.</Empty>
      ) : (
        <List label={`${section.name} ${PRESET.noun}`}>
          {section.presets.map((preset) => (
            <ListItem key={preset.id} title={preset.name} selected={preset === current} onClick={then(() => onPick(preset))} control={menu(preset)} />
          ))}
        </List>
      )}
      {!current && (
        <Button variant="secondary" onClick={then(onSave)}>
          {PRESET.save}
        </Button>
      )}
      <Button variant="link" onClick={then(onEdit)}>
        기본값 바꾸기
      </Button>
    </>
  );
}
