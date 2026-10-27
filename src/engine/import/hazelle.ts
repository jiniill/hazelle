import { count, isRecord, list } from '../../connectors/values';
import type { Portrait, PortraitSource } from '../../model/likeness';
import { fingerprint } from '../memory';
import { add, convertModule, DEFAULT_ORDER, extensionOf, finite, lorebookSource, nativeHolds, readTriggers, record, regexScripts, regexSource, stampIds, strings, text, triggerSource, type Converted, type ConvertedModule, type Json, type Tally, type Unstamped } from './convert';
import { readToggles, writeToggles } from './toggles';
import type { Bot, BundledModule, CharacterOwn, HazelleOwn, LoreEntry, Profiles, RegexScript, Trigger, TypedModule } from './types';

// extensions.hazelle preserves disabled scripts, non-native lore, character settings, 삽화 profiles and bundled modules.
// Risu sees modules merged after the character in module.risum, with their pictures as its assets; the extension restores boundaries.
// print fingerprints convert's reading of the written Risu fields. Risu preserves unknown extensions after edits,
// so mismatched prints must be counted and ignored rather than applying stale entry positions.
const VERSION = 1;

// at: the place in the whole list as this app holds it. shared: the entry is in Risu's list too, read there short of
// what it holds; otherwise it is this app's alone and goes in at its place.
type Kept<T> = { at: number; entry: T; shared?: true };
type Placed = 'risu' | 'shared' | 'own';
type Located = { name: string; uri: string };
export type ConvertedBundle = Omit<BundledModule, 'assets'> & { assets: Located[] };

// toggles: the card's toggle text as card.json holds it. The card read keeps its toggles as lines, but the print takes
// the text it took before they were, so a charx written then still matches.
export const printOf = ({ card, lore, loreFolders, assets }: Converted, toggles: string) =>
  fingerprint([{ role: 'charx', text: JSON.stringify([{ ...card, toggles }, lore, loreFolders, assets.map(({ name }) => name)]) }]);

function partition<T, S>(entries: T[], place: (entry: T) => Placed, kept: (entry: T) => S): { risu: T[]; kept: Kept<S>[] } {
  const risu: T[] = [];
  const own: Kept<S>[] = [];
  entries.forEach((entry, at) => {
    const placed = place(entry);
    if (placed !== 'own') risu.push(entry);
    if (placed !== 'risu') own.push({ at, entry: kept(entry), ...(placed === 'shared' && { shared: true as const }) });
  });
  return { risu, kept: own };
}

// A pack's lists as this app holds them, split into what Risu's own lists hold and what only the extension keeps: the
// scripts turned off, and the lore entries the native lorebook cannot hold whole. lua: whether Risu's list holds a Lua
// trigger, which Risu runs only with lowLevelAccess.
function setApart(regex: RegexScript[], triggers: Trigger[], lore: LoreEntry[]) {
  const scripts = partition(regex, (script) => (script.off ? 'own' : 'risu'), regexSource);
  const run = partition(triggers, (trigger) => (trigger.off ? 'own' : 'risu'), triggerSource);
  const book = partition(lore, (entry) => (!entry.enabled ? 'own' : nativeHolds(entry) ? 'risu' : 'shared'), (entry) => entry);
  return {
    regex: scripts.risu.map(regexSource),
    triggers: run.risu.map(triggerSource),
    lore: book.risu,
    lua: run.risu.some((trigger) => trigger.kind === 'lua'),
    kept: { off: { regex: scripts.kept, triggers: run.kept }, lore: book.kept },
  };
}

// setApart's inverse: Risu's lists as read, with the kept entries back at their places.
function putBack(read: { regex: RegexScript[]; triggers: Trigger[]; lore: LoreEntry[] }, source: Json, tally: Tally) {
  const off = record(source.off);
  return {
    regex: restore(read.regex.map(unstamped), keptOf(off.regex, (entry): Unstamped<RegexScript> | undefined => {
      const [script] = regexScripts([entry], tally);
      return script && { ...script, off: true };
    })),
    triggers: restore(read.triggers.map(unstamped), keptOf(off.triggers, (entry): Unstamped<Trigger> | undefined => {
      const [trigger] = readTriggers([entry]);
      return trigger && { ...trigger, off: true };
    })),
    lore: restore(read.lore, keptOf(source.lore, loreEntry)),
  };
}

// The character's own pack first, then each bundled module's, as one list each: what module.risum and the card's
// assets hold, and the extension without its print.
export function hazelleSource(bot: Bot) {
  const packs = [{ pack: bot.card, lore: bot.lore, loreFolders: bot.loreFolders, assets: bot.assets }, ...bot.bundled];
  let offset = 0;
  const lore = packs.flatMap((pack) => {
    const from = offset;
    offset += pack.loreFolders.length;
    return pack.lore.map((entry) => (entry.folder === null ? entry : { ...entry, folder: entry.folder + from }));
  });
  const apart = setApart(packs.flatMap(({ pack }) => pack.regex), packs.flatMap(({ pack }) => pack.triggers), lore);
  const { translatorNote, keepThoughts, statusScripts, translations } = bot.own.character;
  const status = statusScripts?.flatMap((id) => {
    const at = bot.card.regex.findIndex((script) => script.id === id);
    return at === -1 ? [] : [at];
  });
  return {
    regex: apart.regex,
    triggers: apart.triggers,
    lore: apart.lore,
    lua: apart.lua,
    loreFolders: packs.flatMap((pack) => pack.loreFolders),
    assets: packs.flatMap((pack) => pack.assets),
    extension: {
      version: VERSION,
      character: {
        ...(translatorNote !== undefined && { translatorNote }),
        ...(keepThoughts && { keepThoughts }),
        ...(status && status.length > 0 && { statusScripts: status }),
        ...(translations && translations.length > 0 && { translations: translations.map(({ source, language, translation }) => ({ source, language, text: translation.text, at: translation.at })) }),
      },
      likeness: bot.own.likeness,
      ...apart.kept,
      modules: bot.bundled.map(({ risu, name, description, namespace, pack, likeness, ...module }) => ({
        id: risu,
        name,
        description,
        namespace,
        toggles: writeToggles(pack.toggles),
        ...(pack.background !== undefined && { background: pack.background }),
        likeness,
        regex: pack.regex.length,
        triggers: pack.triggers.length,
        lore: module.lore.length,
        loreFolders: module.loreFolders.length,
        assets: module.assets.length,
      })),
    },
  };
}

function restore<T>(read: T[], kept: Kept<T>[]): T[] {
  const out = [...read];
  for (const { at, entry, shared } of [...kept].sort((a, b) => a.at - b.at)) {
    if (shared && at < out.length) out[at] = entry;
    else if (!shared && at <= out.length) out.splice(at, 0, entry);
  }
  return out;
}

const keptOf = <T>(raw: unknown, entry: (raw: unknown) => T | undefined): Kept<T>[] =>
  list(raw)
    .map(record)
    .flatMap((kept) => {
      const at = count(kept.at);
      const read = entry(kept.entry);
      return at === null || read === undefined ? [] : [{ at, entry: read, ...(kept.shared === true && { shared: true as const }) }];
    });

// The module parts follow the character's, each as long as the extension says; the character's is what is left.
function sections<T>(items: T[], sizes: number[]): T[][] {
  let at = Math.max(0, items.length - sizes.reduce((sum, size) => sum + size, 0));
  return [items.slice(0, at), ...sizes.map((size) => items.slice(at, (at += size)))];
}

function loreEntry(raw: unknown): LoreEntry {
  const entry = record(raw);
  return {
    name: text(entry.name),
    keys: strings(entry.keys),
    secondaryKeys: strings(entry.secondaryKeys),
    content: text(entry.content),
    enabled: entry.enabled === true,
    constant: entry.constant === true,
    selective: entry.selective === true,
    useRegex: entry.useRegex === true,
    caseSensitive: entry.caseSensitive === true,
    insertionOrder: finite(entry.insertionOrder) ?? DEFAULT_ORDER,
    priority: finite(entry.priority),
    position: entry.position === 'before_char' || entry.position === 'after_char' ? entry.position : null,
    folder: count(entry.folder),
  };
}

const SOURCES = new Set<unknown>(['metadata', 'vision', 'text', 'user'] satisfies PortraitSource[]);

function profiles(raw: unknown): Profiles | null {
  if (!isRecord(raw) || typeof raw.at !== 'number') return null;
  const portraits = list(raw.portraits)
    .map(record)
    .flatMap((portrait): Portrait[] =>
      SOURCES.has(portrait.source)
        ? [{
            name: text(portrait.name),
            aliases: strings(portrait.aliases),
            look: text(portrait.look),
            outfits: list(portrait.outfits).map(record).map((outfit) => ({ name: text(outfit.name), tags: text(outfit.tags) })),
            artist: text(portrait.artist),
            source: portrait.source as PortraitSource,
          }]
        : [],
    );
  return { portraits, at: raw.at };
}

// statusScripts are places in the character's regex, named by the ids its scripts are stamped with here.
function characterOwn(raw: Json, regex: RegexScript[]): CharacterOwn {
  const status = list(raw.statusScripts).flatMap((at) => {
    const script = typeof at === 'number' ? regex[at] : undefined;
    return script ? [script.id] : [];
  });
  const translations = list(raw.translations)
    .map(record)
    .flatMap((each) => (typeof each.at === 'number' ? [{ source: text(each.source), language: text(each.language), translation: { text: text(each.text), receipt: null, at: each.at } }] : []));
  return {
    ...(typeof raw.translatorNote === 'string' && { translatorNote: raw.translatorNote }),
    ...(raw.keepThoughts === true && { keepThoughts: true as const }),
    ...(status.length > 0 && { statusScripts: status }),
    ...(translations.length > 0 && { translations }),
  };
}

function unstamped<S extends { id: string }>(script: S): Unstamped<S> {
  const rest: Partial<S> = { ...script };
  delete rest.id;
  return rest as Unstamped<S>;
}

// raw: the card's extensions.hazelle, absent from any file but this app's own charx. toggles: as printOf takes them.
export function readHazelle(raw: unknown, toggles: string, read: Converted, tally: Tally): { read: Converted; own: HazelleOwn | null; bundled: ConvertedBundle[] } {
  if (raw === undefined) return { read, own: null, bundled: [] };
  const source = record(raw);
  if (source.version !== VERSION || source.print !== printOf(read, toggles)) {
    add(tally, 'hazelle');
    return { read, own: null, bundled: [] };
  }
  const modules = list(source.modules).map(record);
  const sizes = (field: string) => modules.map((module) => count(module[field]) ?? 0);
  const back = putBack({ regex: read.card.regex, triggers: read.card.triggers, lore: read.lore }, source, tally);
  const regex = sections(back.regex, sizes('regex'));
  const triggers = sections(back.triggers, sizes('triggers'));
  const lore = sections(back.lore, sizes('lore'));
  const folderSizes = sizes('loreFolders');
  const folders = sections(read.loreFolders, folderSizes);
  const assets = sections(read.assets, sizes('assets'));
  // Each part's entries name folders by their place in the whole list; within a part, by their place in its own.
  let offset = 0;
  const part = (index: number) => {
    const from = offset;
    const own = folders[index]!;
    offset += own.length;
    const entries = lore[index]!.map((entry) => {
      const folder = entry.folder === null ? -1 : entry.folder - from;
      return { ...entry, folder: folder >= 0 && folder < own.length ? folder : null };
    });
    return { pack: stampIds({ regex: regex[index]!, triggers: triggers[index]! }), lore: entries, loreFolders: own, assets: assets[index]! };
  };
  const character = part(0);
  const card = { ...read.card, ...character.pack };
  return {
    read: { ...read, card, lore: character.lore, loreFolders: character.loreFolders, assets: character.assets },
    own: { character: characterOwn(record(source.character), card.regex), likeness: profiles(source.likeness) },
    bundled: modules.map((module, index) => {
      const { pack, ...owned } = part(index + 1);
      const background = text(module.background);
      return {
        name: text(module.name),
        description: text(module.description),
        namespace: text(module.namespace) || null,
        risu: text(module.id) || null,
        pack: { ...pack, ...(background && { background }), toggles: readToggles(text(module.toggles)) },
        ...owned,
        unsupported: [],
        likeness: profiles(module.likeness),
      };
    }),
  };
}

// .risum's hazelle key preserves disabled scripts/non-native lore. Fingerprint convertModule's re-read output,
// excluding the module id because Risu replaces it on import.
const modulePrint = ({ pack, lore, loreFolders, assets }: ConvertedModule) => fingerprint([{ role: 'module', text: JSON.stringify([pack, lore, loreFolders, assets]) }]);

// The module JSON of a .risum, its pictures named in the order their blocks follow. Its tool, 삽화 profiles and model and
// memory switches have no place in it.
export function moduleSource({ risu, name, description, namespace, pack, lore, loreFolders, assets }: TypedModule): Json {
  const apart = setApart(pack.regex, pack.triggers, lore);
  const source: Json = {
    name,
    description,
    id: risu,
    ...(namespace !== null && { namespace }),
    lorebook: lorebookSource(apart.lore, loreFolders),
    regex: apart.regex,
    trigger: apart.triggers,
    ...(pack.background !== undefined && { backgroundEmbedding: pack.background }),
    customModuleToggle: writeToggles(pack.toggles),
    assets: assets.map(({ name, type }) => [name, '', extensionOf(type)]),
    hideIcon: false,
    ...(apart.lua && { lowLevelAccess: true }),
  };
  return { ...source, hazelle: { version: VERSION, ...apart.kept, print: modulePrint(convertModule(source, new Map())) } };
}

// A module file's JSON as convertModule reads it, with what its hazelle key keeps put back when the print matches.
export function readModule(raw: Json, tally: Tally): ConvertedModule {
  const read = convertModule(raw, tally);
  if (raw.hazelle === undefined) return read;
  const source = record(raw.hazelle);
  if (source.version !== VERSION || source.print !== modulePrint(read)) {
    add(tally, 'hazelle');
    return read;
  }
  const back = putBack({ regex: read.pack.regex, triggers: read.pack.triggers, lore: read.lore }, source, tally);
  return { ...read, pack: { ...read.pack, ...stampIds(back) }, lore: back.lore };
}
