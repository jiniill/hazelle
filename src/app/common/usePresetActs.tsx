import { useState, type ReactNode } from 'react';
import type { ApiFailure, ApiResult } from '../../runtime/api';
import { useToast } from '../toast';
import { MenuItem } from '../ui';
import { ACTS } from './acts';
import { NameDialog } from './NameDialog';
import { useRemoval } from './useRemoval';
import { PRESET, SAVE_FAILED } from './words';

type Done = Promise<{ ok: true } | ApiFailure>;
type Props<P, R> = {
  // How many there are, which names a new one.
  count: number;
  current: P | null | undefined;
  // What is in use now, kept under a new name or over an old one's values; null while there is nothing to keep.
  keep: { add: (name: string) => Done; over: (preset: P) => Done } | null;
  rename: (preset: P, name: string) => Done;
  remove: (preset: P) => Promise<ApiResult<R>>;
  restore: (removed: R) => Done;
};

// What every list of the user's own presets does to one: named as it is saved, renamed, overwritten with what is in
// use now, deleted with its 되돌리기. save: null while there is nothing to keep. items: a preset's ⋯, the list's own acts
// (more) before 삭제. dialog: mounted beside the list.
export function usePresetActs<P extends { id: string; name: string }, R>({ count, current, keep, rename, remove, restore }: Props<P, R>) {
  const toast = useToast();
  const removal = useRemoval();
  const [naming, setNaming] = useState<{ preset: P | null } | null>(null);

  function name(typed: string) {
    const preset = naming!.preset;
    setNaming(null);
    toast.settled(preset ? rename(preset, typed) : keep!.add(typed), SAVE_FAILED);
  }

  return {
    save: keep && (() => setNaming({ preset: null })),
    items: (preset: P, more?: ReactNode) => (
      <>
        <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming({ preset })} />
        {keep && preset !== current && <MenuItem icon={ACTS.overwrite.icon} label={ACTS.overwrite.label} onClick={() => toast.settled(keep.over(preset), SAVE_FAILED)} />}
        {more}
        <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void removal({ name: () => preset.name, noun: PRESET.noun, task: () => remove(preset), restore })} />
      </>
    ),
    dialog: naming && <NameDialog title={naming.preset ? PRESET.rename : PRESET.save} value={naming.preset?.name ?? PRESET.named(count)} onSave={name} onClose={() => setNaming(null)} />,
  };
}
