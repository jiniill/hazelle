import { useState } from 'react';
import { moved } from '../../model/fields';
import type { PackOwner } from '../../model/library';
import type { ToggleLine } from '../../model/prompt';
import { rekeyed } from '../../model/toggles';
import { setToggles } from '../../runtime/pack';
import { useStore } from '../session';
import { TogglePane } from './TogglePane';
import { useAutosave } from './useAutosave';

// A pack has no conditions of its own to rewrite with a key, and no undo: each change writes the list it makes, a
// default typed in place after a pause.
export function PackToggles({ owner, lines: stored }: { owner: PackOwner; lines: ToggleLine[] }) {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const save = useAutosave<{ toggles: ToggleLine[] }>(`pack-toggles:${owner.id}`, ({ toggles }) => setToggles(store, owner, toggles!));
  const lines = save.unsaved.toggles ?? stored;
  const write = (toggles: ToggleLine[]) => void save.save({ toggles });
  return (
    <TogglePane
      owner={owner.id}
      lines={lines}
      uses={null}
      onAdd={(added) => write([...lines, ...added])}
      onEdit={(_, after, at) => write(lines.with(at, after))}
      onType={(after, at) => save.change({ toggles: lines.with(at, after) })}
      onMove={(_, { from, count, to }) => write(moved(lines, from, to, count))}
      onRekey={(toggle, to) => write(rekeyed(lines, toggle.key, to))}
      onRemove={(gone) => write(lines.filter((_, at) => !gone.some((line) => line.at === at)))}
      adding={adding}
      onAdding={setAdding}
    />
  );
}
