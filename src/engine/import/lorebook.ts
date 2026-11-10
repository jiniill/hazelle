import { jsonObject, text } from '../../connectors/values';
import { isRecord } from '../../record';
import { bookLorebook, countTags, finite, record, strings, type Json, type Tally } from './convert';
import { moduleSource, readModule } from './hazelle';
import type { LoreEntry } from './types';

export type LorebookRead = { name: string; description: string; lore: LoreEntry[]; loreFolders: string[] };

// Accept standalone lorebook shapes only; cards nest lore under data, never top-level entries.
// Support Risu/Hazelle, SillyTavern (entries keyed by uid), NovelAI and CCv3 books.
export function readLorebook(raw: Json, tally: Tally): LorebookRead | null {
  const named = { name: text(raw.name), description: text(raw.description) };
  const native = (lorebook: Json[], hazelle?: unknown) => {
    const { lore, loreFolders } = readModule({ ...named, lorebook, ...(hazelle !== undefined && { hazelle }) }, tally);
    return { ...named, lore, loreFolders };
  };
  // type 'risu' with a record for data is a HypaV3 preset export.
  if (raw.type === 'risu' && Array.isArray(raw.data)) return native(raw.data, raw.hazelle);
  const book = (entries: unknown[]) => {
    const read = bookLorebook(entries);
    countTags(read.lore.map(({ content }) => content), tally);
    return { ...named, ...read };
  };
  if (Array.isArray(raw.entries) && raw.lorebookVersion === undefined) return book(raw.entries);
  if (isRecord(raw.entries)) return book(Object.values(raw.entries).filter(isRecord).map(worldEntry));
  if (Array.isArray(raw.entries)) return native(raw.entries.filter(isRecord).map(externalLore));
  return null;
}

// SillyTavern's world info entry as its own character-book export writes it (position 0 and 1 are before and after the
// character, 4 is at a depth), so the book reader takes what both carry. Its keys are regexes when written /…/.
function worldEntry(raw: Json): Json {
  return {
    keys: raw.key,
    secondary_keys: raw.keysecondary,
    comment: raw.comment,
    content: raw.content,
    constant: raw.constant,
    selective: raw.selective,
    insertion_order: raw.order,
    enabled: raw.disable !== true,
    position: raw.position === 0 ? 'before_char' : raw.position === 1 ? 'after_char' : null,
    use_regex: true,
    case_sensitive: raw.caseSensitive,
    extensions: {
      position: raw.position,
      depth: raw.depth,
      role: raw.role,
      selectiveLogic: raw.selectiveLogic,
      useProbability: raw.useProbability,
      probability: raw.probability,
      delay: raw.delay,
      match_whole_words: raw.matchWholeWords,
    },
  };
}

// A file picked in a lorebook's 가져오기; null for one that is no lorebook.
export function readLorebookText(text: string): LorebookRead | null {
  const raw = jsonObject(text);
  return raw && readLorebook(raw, new Map());
}

// Convert external lore, NovelAI's among them, as Risu does.
function externalLore(raw: Json): Json {
  const joined = (value: unknown) => strings(value).join(', ');
  return {
    key: joined(raw.key ?? raw.keys ?? raw.keywords),
    secondkey: joined(raw.secondary_keys),
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
