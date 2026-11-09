import { describe, expect, it } from 'vitest';
import { lorebookFile, readLorebookText } from './lorebook';
import type { LoreEntry } from './types';

const entry = (name: string, change: Partial<LoreEntry> = {}): LoreEntry => ({
  name, keys: [name], secondaryKeys: [], content: `${name} body`, enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 100, priority: null, position: null, folder: null, ...change,
});

describe('lorebook file', () => {
  it("gives back whole what Risu's lorebook cannot hold, while Risu reads only the entries it can", () => {
    const lore = [entry('gate', { folder: 0 }), entry('off', { enabled: false }), entry('first', { priority: 9, position: 'before_char', keys: ['a, b'] })];
    const file = lorebookFile('Luna', lore, ['places']);
    expect((file.data as { comment: string }[]).map(({ comment }) => comment)).toEqual(['places', 'gate', 'first']);
    expect(readLorebookText(JSON.stringify(file))).toEqual({ name: 'Luna', description: '', lore, loreFolders: ['places'] });
  });

  it('reads a CCv3 character_book alone by its own fields, and NovelAI entries as Risu does', () => {
    const book = { entries: [{ keys: ['gate'], content: 'A gate.', enabled: false, insertion_order: 4, priority: 2, case_sensitive: true }] };
    expect(readLorebookText(JSON.stringify(book))?.lore).toMatchObject([{ keys: ['gate'], enabled: false, insertionOrder: 4, priority: 2, caseSensitive: true }]);
    const novel = { lorebookVersion: 5, entries: [{ displayName: 'Gate', keys: ['gate'], text: 'A gate.', contextConfig: { budgetPriority: 400 } }] };
    expect(readLorebookText(JSON.stringify(novel))?.lore).toMatchObject([{ name: 'Gate', keys: ['gate'], content: 'A gate.', insertionOrder: 400 }]);
    expect(readLorebookText('{"name": "card", "data": {}}')).toBeNull();
  });

  it("reads SillyTavern's world info with what its character-book export carries: off, place, depth, logic, chance", () => {
    const world = {
      entries: {
        0: { uid: 0, key: ['gate', '/ga?te/i'], keysecondary: ['night'], comment: 'Gate', content: 'A gate.', constant: false, selective: true, selectiveLogic: 3, order: 7, position: 1, disable: true, caseSensitive: true, matchWholeWords: false },
        1: { uid: 1, key: ['sea'], keysecondary: [], comment: 'Sea', content: 'The sea.', constant: true, selective: true, selectiveLogic: 0, order: 100, position: 4, depth: 2, role: 1, useProbability: true, probability: 40 },
        2: { uid: 2, key: ['note'], comment: 'Note', content: 'A note.', order: 100, position: 2 },
      },
    };
    expect(readLorebookText(JSON.stringify(world))?.lore).toEqual([
      entry('Gate', { keys: ['gate', '/ga?te/i'], secondaryKeys: ['night'], content: '@@match_partial_word\n@@additional_keys night\nA gate.', enabled: false, useRegex: true, caseSensitive: true, insertionOrder: 7, position: 'after_char' }),
      entry('Sea', { keys: ['sea'], content: '@@depth 2\n@@role user\n@@probability 40\nThe sea.', constant: true, selective: true, useRegex: true }),
      entry('Note', { keys: ['note'], content: 'A note.', useRegex: true }),
    ]);
  });
});
