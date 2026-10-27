import { isRecord } from '../../connectors/values';
import { bookLorebook, countTags, finite, record, strings, text, type Json, type Tally } from './convert';
import { moduleSource, readModule } from './hazelle';
import type { LoreEntry } from './types';

export type LorebookRead = { name: string; description: string; lore: LoreEntry[]; loreFolders: string[] };

// Accept standalone lorebook shapes only; cards nest lore under data, never top-level entries.
// Support Risu/Hazelle, SillyTavern, NovelAI and CCv3 books.
export function readLorebook(raw: Json, tally: Tally): LorebookRead | null {
  const named = { name: text(raw.name), description: text(raw.description) };
  const native = (lorebook: Json[], hazelle?: unknown) => {
    const { lore, loreFolders } = readModule({ ...named, lorebook, ...(hazelle !== undefined && { hazelle }) }, tally);
    return { ...named, lore, loreFolders };
  };
  // type 'risu' with a record for data is a HypaV3 preset export.
  if (raw.type === 'risu' && Array.isArray(raw.data)) return native(raw.data, raw.hazelle);
  if (Array.isArray(raw.entries) && raw.lorebookVersion === undefined) {
    const book = bookLorebook(raw.entries);
    countTags(book.lore.map(({ content }) => content), tally);
    return { ...named, ...book };
  }
  if (isRecord(raw.entries) || Array.isArray(raw.entries)) return native(Object.values(raw.entries).filter(isRecord).map(externalLore));
  return null;
}

// A file picked in a lorebook's 가져오기; null for one that is no lorebook.
export function readLorebookText(text: string): LorebookRead | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(raw) ? readLorebook(raw, new Map()) : null;
}

// Convert external lore as Risu does, but also read SillyTavern keysecondary, which Risu misses.
function externalLore(raw: Json): Json {
  const joined = (value: unknown) => strings(value).join(', ');
  return {
    key: joined(raw.key ?? raw.keys ?? raw.keywords),
    secondkey: joined(raw.secondary_keys ?? raw.keysecondary),
    insertorder: finite(raw.order) ?? finite(raw.priority) ?? finite(record(raw.contextConfig).budgetPriority) ?? 0,
    comment: text(raw.comment) || text(raw.name) || text(raw.displayName),
    content: text(raw.content) || text(raw.entry) || text(raw.text),
    mode: 'normal',
    alwaysActive: (raw.constant ?? raw.forceActivation) === true,
    selective: raw.selective === true,
  };
}

// Export native entries as Risu type/data; preserve non-native fields through the module-shaped hazelle extension
// so readLorebook/readModule can restore them.
export function lorebookFile(name: string, lore: LoreEntry[], loreFolders: string[]): Json {
  const { lorebook, hazelle } = moduleSource({ risu: '', name, description: '', namespace: null, pack: { regex: [], triggers: [], toggles: [] }, lore, loreFolders, assets: [], likeness: null });
  return { type: 'risu', ver: 1, name, data: lorebook, hazelle };
}
