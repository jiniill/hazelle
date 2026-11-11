import type { LoreFolder } from '../../model/library';
import type { StatusDefinition } from '../../model/status';
import { setStatus, type StatusOwner } from '../../runtime/library/status';
import { useChildren, useStore } from '../session';
import { StatusEditor } from './StatusEditor';
import { useAutosave } from './useAutosave';

// A definition has no undo: each change writes the whole of it, its name typed in place after a pause. null is the
// definition removed, waiting to be saved. folders: a pack's lorebook folders, which a 묶음 may follow.
export function StatusPane({ owner, definition: stored, folders }: { owner: StatusOwner; definition: StatusDefinition | undefined; folders?: readonly LoreFolder[] }) {
  const store = useStore();
  const entries = useChildren('lore', folders ? owner.id : null);
  const save = useAutosave<{ status: StatusDefinition | null }>(`status:${owner.id}`, ({ status }) => setStatus(store, owner, status ?? undefined));
  const definition = save.unsaved.status === undefined ? stored : (save.unsaved.status ?? undefined);
  return <StatusEditor definition={definition} onChange={(status) => void save.save({ status: status ?? null })} onType={(status, valid) => save.change({ status }, valid)} lore={folders && { folders, entries }} />;
}
