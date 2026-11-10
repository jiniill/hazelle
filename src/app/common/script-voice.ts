import { live, type PackOwner } from '../../model/library';
import { toolId } from '../../model/tool';
import type { ObjectStore } from '../../runtime/store/store';
import { aliased } from './alias';
import type { Asker } from './words';

export function scriptVoice(store: ObjectStore, owner: PackOwner | null): { name: string; face: string | null; asker: Asker } | null {
  if (!owner) return null;
  if (owner.kind === 'module') {
    const module = live(store.get('module', owner.id));
    return module && { name: module.value.name, face: null, asker: store.get('tool', toolId(owner.id)) ? 'plugin' : 'module' };
  }
  const character = live(store.get('character', owner.id));
  return character && { name: aliased(character.value.card.name, character.value.alias), face: store.children('avatar', owner.id)[0]?.value.thumb ?? null, asker: 'character' };
}
