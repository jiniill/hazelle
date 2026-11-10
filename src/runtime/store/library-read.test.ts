import { expect, it, vi } from 'vitest';
import type { Card } from '../../engine/import/types';
import type { Kind, Stored } from '../../model/kinds';
import type { Mark } from '../../model/library';
import { ReadModels } from './read-model';
import type { ObjectStore } from './store';
import type { StoreChange } from './object-index';

const folder = (id: string, name: string, parent?: string): Stored<'folder'> => ({ id, kind: 'folder', parent: null, rev: 1, value: { name, ...(parent === undefined ? {} : { parent }) } });
const character = (id: string, inFolder: string | null, rev: number, mark: Mark = {}): Stored<'character'> => ({ id, kind: 'character', parent: null, rev, value: { card: { name: id } as Card, folder: inFolder, loreFolders: [], ...mark } });
const ids = (items: readonly { id: string }[]) => items.map(({ id }) => id);

it('indexes folder membership and bin characters once per changed snapshot without losing recency, orphans or live subscriptions', () => {
  const initial: Stored<Kind>[] = [
    folder('f', '판타지'), folder('k', '기사단', 'f'), folder('o', '고아', 'gone'),
    character('a', 'k', 50), character('b', 'f', 20), character('c', 'missing', 40), character('d', null, 30), character('e', 'o', 10),
    character('g', 'f', 60, { deleted: 1 }), character('p', 'f', 70, { deleted: 1, purging: true }),
    { id: 'dead-b', kind: 'chat', parent: null, rev: 1, value: { title: 'b의 채팅', character: 'b', models: {}, deleted: 1 } },
    { id: 'dead-g', kind: 'chat', parent: null, rev: 1, value: { title: 'g의 채팅', character: 'g', models: {}, deleted: 1 } },
  ];
  const items = new Map(initial.map((item) => [item.id, item]));
  const listeners = new Set<(changes: readonly StoreChange[]) => void>();
  const store = {
    list: (kind: Kind) => [...items.values()].filter((item) => item.kind === kind),
    get: (kind: Kind, id: string) => items.get(id)?.kind === kind ? items.get(id)! : null,
    projections: { get: () => null },
    unreadable: () => 0,
    subscribe: (listener: (changes: readonly StoreChange[]) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } as unknown as ObjectStore;
  const announce = (kind: Kind, id: string) => { for (const listener of listeners) listener([{ kind, id, parent: null }]); };
  const read = new ReadModels(store);
  const before = read.library.snapshot();
  const own = read.character('a');
  const ownBefore = own.snapshot();
  const changed = vi.fn();
  const stop = own.subscribe(changed);
  expect([...before.byFolder.keys()].sort()).toEqual(['f', 'k', 'o']);
  expect(ids(before.byFolder.get('f')!.inside)).toEqual(['a', 'b']);
  expect(ids(before.byFolder.get('f')!.direct)).toEqual(['b']);
  expect(ids(before.byFolder.get('k')!.inside)).toEqual(['a']);
  expect(before.byFolder.get('k')!.up).toBe(before.byFolder.get('f')!.folder);
  expect(ids(before.loose)).toEqual(['c', 'd']);
  expect(before.byCharacter.get('g')?.character.deleted).toBe(1);
  expect(before.byCharacter.has('p')).toBe(false);
  expect(read.character('g').snapshot()).toBeNull();
  expect(ids(before.deletedChats)).toEqual(['dead-b']);
  expect(before.byCharacter.get(before.deletedChats[0]!.chat.character!)?.id).toBe('b');

  announce('prompt', 'unrelated');
  expect(read.library.snapshot()).toBe(before);
  items.set('k', folder('k', '새 기사단', 'f'));
  announce('folder', 'k');
  const renamed = read.library.snapshot();
  expect(renamed.byCharacter).toBe(before.byCharacter);
  expect(renamed.byFolder).not.toBe(before.byFolder);
  expect(renamed.byFolder.get('k')!.folder.value.name).toBe('새 기사단');
  expect(own.snapshot()).toBe(ownBefore);

  items.set('c', character('c', 'k', 80));
  announce('character', 'c');
  const moved = read.library.snapshot();
  expect(ids(moved.byFolder.get('f')!.inside)).toEqual(['a', 'b', 'c']);
  expect(ids(moved.byFolder.get('k')!.direct)).toEqual(['a', 'c']);
  expect(ids(moved.loose)).toEqual(['d']);
  expect(changed).not.toHaveBeenCalled();

  items.delete('f');
  announce('folder', 'f');
  const orphaned = read.library.snapshot();
  expect(orphaned.byFolder.get('k')!.up).toBeNull();
  expect(ids(orphaned.byFolder.get('k')!.inside)).toEqual(['a', 'c']);
  expect(ids(orphaned.loose)).toEqual(['b', 'd']);
  items.set('a', character('a', 'k', 90, { deleted: 3 }));
  announce('character', 'a');
  expect(ids(read.library.snapshot().byFolder.get('k')!.inside)).toEqual(['c']);
  expect(read.library.snapshot().byCharacter.get('a')?.character.deleted).toBe(3);
  expect(own.snapshot()).toBeNull();
  expect(changed).toHaveBeenCalledOnce();
  stop();
  read.close();
});
