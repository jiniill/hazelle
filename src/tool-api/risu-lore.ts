// Risu's lorebook entry, as its files, a bot's CBS and Lua and its getDatabase hold one: the export and the bot's CBS and
// Lua write it whole, the plugin adapter only what Hazelle.LoreEntry holds; the import and the adapter read it back.

// Risu holds an entry's keys as one string it splits at its commas, trimmed, blanks dropped: the separator a writer joins
// with is lost on that split, but not on a bot or plugin that reads the string itself.
type Separator = ',' | ', ';
export const risuKeys = (key: string) => key.split(',').map((each) => each.trim()).filter((each) => each !== '');

type Base = { name: string; keys: string[]; content: string; constant: boolean };
type Whole = Base & { secondaryKeys: string[]; insertionOrder: number; selective: boolean; useRegex: boolean };

// Each writer keeps the field order its readers have always met.
export const risuLoreBase = ({ name, keys, content, constant }: Base, separator: Separator) => ({ comment: name, key: keys.join(separator), content, alwaysActive: constant });

export function risuLore(entry: Whole, separator: Separator) {
  const { comment, key, content, alwaysActive } = risuLoreBase(entry, separator);
  return { key, secondkey: entry.secondaryKeys.join(separator), comment, content, insertorder: entry.insertionOrder, alwaysActive, selective: entry.selective, useRegex: entry.useRegex, mode: 'normal' };
}

// text: how the caller takes a field as text. insertorder the import reads itself, by the default CCv3's lore shares.
type Text = (value: unknown) => string;
export const readRisuLoreBase = (raw: Record<string, unknown>, text: Text): Base => ({ name: text(raw.comment), keys: risuKeys(text(raw.key)), content: text(raw.content), constant: raw.alwaysActive === true });

export const readRisuLore = (raw: Record<string, unknown>, text: Text): Omit<Whole, 'insertionOrder'> => ({
  ...readRisuLoreBase(raw, text),
  secondaryKeys: risuKeys(text(raw.secondkey)),
  selective: raw.selective === true,
  useRegex: raw.useRegex === true,
});
