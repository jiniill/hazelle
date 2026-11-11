import { without } from '../../model/fields';
import type { PackOwner } from '../../model/library';
import type { StatusDefinition } from '../../model/status';
import type { ApiResult } from '../api';
import type { ObjectStore } from '../store/store';

// What declares a chat's state (design §6.1 part 1): a pack, or a conversation prompt.
export type StatusOwner = PackOwner | { kind: 'prompt'; id: string };

// The whole definition, as a pack's toggles are written (setToggles); undefined declares none. Values a chat keeps
// under a removed definition's id stay where they are and are read by nothing.
export function setStatus(store: ObjectStore, owner: StatusOwner, status: StatusDefinition | undefined): Promise<ApiResult<unknown>> {
  const put = <H extends { status?: StatusDefinition }>(holder: H): H => (status ? { ...holder, status } : without(holder, 'status'));
  switch (owner.kind) {
    case 'character':
      return store.update('character', owner.id, (current) => ({ ...current, card: put(current.card) }));
    case 'module':
      return store.update('module', owner.id, put);
    case 'prompt':
      return store.update('prompt', owner.id, (current) => (current.task === undefined ? put(current) : null));
  }
}
