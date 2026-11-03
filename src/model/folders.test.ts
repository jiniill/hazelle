import { describe, expect, it } from 'vitest';
import type { Stored } from './kinds';
import { holds, indexFolders, nest, pathOf } from './folders';

const folder = (id: string, name: string, parent?: string, of?: 'prompt' | 'module' | 'persona'): Stored<'folder'> => ({ id, kind: 'folder', parent: null, rev: 1, value: { name, ...(parent && { parent }), ...(of && { of }) } });

describe('nest', () => {
  it('puts subfolders under their top folder by name, and lifts one whose top folder is gone', () => {
    const tree = nest([folder('k', '기사단', 'f'), folder('f', '판타지'), folder('m', '마법사', 'f'), folder('o', '고아', 'gone'), folder('d', '데일리')], 'character');
    expect(tree.map((top) => [top.id, top.children.map((child) => child.id)])).toEqual([
      ['o', []],
      ['d', []],
      ['f', ['k', 'm']],
    ]);
    expect(holds(tree[2]!, 'k')).toBe(true);
    expect(holds(tree[2]!.children[1]!, 'k')).toBe(false);
  });

  it('nests a third level, whose things its top folder holds and whose path runs from the top', () => {
    const tree = nest([folder('s', '학원물', 'k'), folder('k', '기사단', 'f'), folder('f', '판타지')], 'character');
    expect(tree.map((top) => top.id)).toEqual(['f']);
    expect(tree[0]!.children[0]!.children.map((child) => child.id)).toEqual(['s']);
    expect(holds(tree[0]!, 's')).toBe(true);
    const { byFolder } = indexFolders([], tree, () => null);
    expect(pathOf(byFolder, 's').map(({ id }) => id)).toEqual(['f', 'k', 's']);
  });

  it("takes only one kind's folders: a folder with no kind named is a character's", () => {
    const all = [folder('c', '판타지'), folder('p', '롤플레이', undefined, 'prompt'), folder('q', '짧게', 'p', 'prompt'), folder('m', '판타지', undefined, 'module')];
    expect(nest(all, 'character').map(({ id }) => id)).toEqual(['c']);
    expect(nest(all, 'prompt').map((top) => [top.id, top.children.map(({ id }) => id)])).toEqual([['p', ['q']]]);
    expect(nest(all, 'persona')).toEqual([]);
  });

  it("takes one character's chat folders, 캐릭터 없이's apart", () => {
    const chats = (id: string, character: string | null): Stored<'folder'> => ({ id, kind: 'folder', parent: null, rev: 1, value: { name: id, of: 'chat', character } });
    const all = [folder('c', '판타지'), chats('a', 'luna'), chats('b', 'mira'), chats('n', null)];
    expect([nest(all, { chats: 'luna' }), nest(all, { chats: null }), nest(all, 'character')].map((tree) => tree.map(({ id }) => id))).toEqual([['a'], ['n'], ['c']]);
  });
});

describe('indexFolders', () => {
  it('files each thing in its folder and every folder above it, in the order given, and one naming a gone folder in none', () => {
    const tree = nest([folder('f', '판타지', undefined, 'prompt'), folder('k', '기사단', 'f', 'prompt')], 'prompt');
    const items = [{ id: 'a', at: 'k' }, { id: 'b', at: 'f' }, { id: 'c', at: 'gone' }, { id: 'd', at: null }];
    const { byFolder, loose } = indexFolders(items, tree, (item) => item.at);
    expect(byFolder.get('f')!.direct.map(({ id }) => id)).toEqual(['b']);
    expect(byFolder.get('f')!.inside.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(byFolder.get('k')!.up?.id).toBe('f');
    expect(loose.map(({ id }) => id)).toEqual(['c', 'd']);
  });
});
