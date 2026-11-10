import { describe, expect, it } from 'vitest';
import { readRisuLore, readRisuLoreBase, risuLore, risuLoreBase } from './risu-lore';

const entry = { name: 'Gate', keys: ['gate', 'door'], secondaryKeys: ['night'], content: 'Shut.', constant: true, selective: true, useRegex: false, insertionOrder: 7 };
const asText = (value: unknown) => (typeof value === 'string' ? value : '');

describe("Risu's lorebook entry", () => {
  it('writes the export\'s keys with "," and the bot\'s with ", ", in its field order, and reads either back', () => {
    for (const [separator, key] of [[',', 'gate,door'], [', ', 'gate, door']] as const) {
      const written = risuLore(entry, separator);
      expect(JSON.stringify(written)).toBe(`{"key":"${key}","secondkey":"night","comment":"Gate","content":"Shut.","insertorder":7,"alwaysActive":true,"selective":true,"useRegex":false,"mode":"normal"}`);
      expect({ ...readRisuLore(written, asText), insertionOrder: written.insertorder }).toEqual(entry);
    }
  });

  it("writes and reads a plugin's entry, which holds only the base fields", () => {
    const written = risuLoreBase(entry, ', ');
    expect(JSON.stringify(written)).toBe('{"comment":"Gate","key":"gate, door","content":"Shut.","alwaysActive":true}');
    expect(readRisuLoreBase({ ...written, key: ' gate ,, door ' }, (value) => String(value ?? ''))).toEqual({ name: 'Gate', keys: ['gate', 'door'], content: 'Shut.', constant: true });
  });
});
