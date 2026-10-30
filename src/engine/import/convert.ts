import { count, flag, isRecord, list } from '../../connectors/values';
import { isUnsupportedTag } from '../cbs/tags';
import { args, parseDecorators } from '../lorebook/decorators';
import { readToggles, writeToggles } from './toggles';
import { blockConditions, blockEffects, conditionSources, effectSources } from './blocks';
import type { Card, ImportedModule, ImportReport, LoreEntry, Pack, RegexScript, Trigger, UnsupportedKind } from './types';

export type Json = Record<string, unknown>;
type Entry = Omit<LoreEntry, 'name' | 'folder'>;

export type Tally<K = UnsupportedKind> = Map<K, number>;

export function add<K>(tally: Tally<K>, kind: K, amount = 1) {
  tally.set(kind, (tally.get(kind) ?? 0) + amount);
}

export function counted<K>(kinds: readonly K[], tally: Tally<K>): { kind: K; count: number }[] {
  return kinds.flatMap((kind) => {
    const count = tally.get(kind) ?? 0;
    return count > 0 ? [{ kind, count }] : [];
  });
}

export type Converted = {
  card: Card;
  lore: LoreEntry[];
  loreFolders: string[];
  spec: ImportReport['spec'];
  icon: string | null;
  assets: { name: string; uri: string }[];
};

const SPECS = new Map<unknown, ImportReport['spec']>([
  ['chara_card_v2', 'v2'],
  ['chara_card_v3', 'v3'],
]);
const STAGES = new Map<unknown, RegexScript['stage']>([
  ['editinput', 'input'],
  ['editoutput', 'output'],
  ['editprocess', 'process'],
  ['editdisplay', 'display'],
]);
const ROLES = ['system', 'user', 'assistant'];
// Risu's order for a new entry. CCv3 requires insertion_order, so only a malformed file goes without one.
export const DEFAULT_ORDER = 100;

export const text = (value: unknown) => (typeof value === 'string' ? value : '');
export const record = (value: unknown): Json => (isRecord(value) ? value : {});
export const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
export const strings = (value: unknown) => list(value).filter((item): item is string => typeof item === 'string');
// CCv3 key arrays stay intact; only blank keys are dropped.
const keys = (value: unknown) => strings(value).filter((key) => key.trim() !== '');
// Risu's own lore joins keys into one string, split here as Risu splits it.
const split = (value: unknown) => args(text(value));
const order = (value: unknown) => finite(value) ?? DEFAULT_ORDER;

// module: a charx's module.risum. Its regex and triggers replace the card's, and its lorebook, when it has one,
// replaces the character_book entries; lore settings stay the card's (characterCards.ts:148-158 at ca1345fc).
// nativeLore: a backup's globalLore, kept apart from CCv3 because bookVersion controls Risu's open-time migration.
export function convert(raw: unknown, module: Json | null, tally: Tally, nativeLore: unknown[] | null = null): Converted | null {
  if (!isRecord(raw)) return null;
  const spec = SPECS.get(raw.spec) ?? 'v1';
  const data = spec === 'v1' ? tavern(raw) : isRecord(raw.data) ? raw.data : null;
  if (!data) return null;
  const extensions = record(data.extensions);
  const risu = record(extensions.risuai);
  const book = record(data.character_book);

  const listed = spec === 'v3' ? list(data.assets) : [];
  const icon = pickIcon(listed);
  // Risu's own assets: CCv3's x-risu-asset, and v2's additionalAssets as [name, uri, extension]. Emotions, voices and
  // other asset types are not read.
  const assets =
    spec === 'v3'
      ? listed.filter((asset): asset is Json => isRecord(asset) && asset.type === 'x-risu-asset').map((asset) => ({ name: text(asset.name), uri: text(asset.uri) }))
      : list(risu.additionalAssets).filter(Array.isArray).map(([name, uri]) => ({ name: text(name), uri: text(uri) }));
  for (const asset of listed) {
    if (asset === icon) continue;
    const type = isRecord(asset) ? asset.type : undefined;
    if (type === 'x-risu-asset') continue;
    add(tally, type === 'icon' ? 'extra-icon' : type === 'emotion' ? 'emotion' : type === 'background' ? 'background' : 'other-asset');
  }
  if (spec === 'v2') {
    add(tally, 'emotion', list(risu.emotions).length);
    add(tally, 'voice', Object.keys(record(risu.vits)).length);
  }
  const pack = packOf({ regex: module ? module.regex : risu.customScripts, trigger: module ? module.trigger : risu.triggerscript, background: risu.backgroundHTML, toggles: risu.toggles }, tally);
  if (text(risu.additionalText).trim()) add(tally, 'additional-text');
  if (risu.prebuiltAssetCommand === true) add(tally, 'prebuilt-asset-command');
  if (risu.largePortrait === true) add(tally, 'large-portrait');
  // Risu's inlay mode and its instruction text (newGenData) act only while this is on.
  if (risu.viewScreen === 'emotion' || risu.viewScreen === 'imggen') add(tally, 'view-screen');
  if (text(record(extensions.depth_prompt).prompt).trim()) add(tally, 'depth-prompt');
  if (record(risu.onboarding).enabled === true) add(tally, 'onboarding');

  const greetings = [data.first_mes, ...list(data.alternate_greetings)].map(text);
  while (greetings.at(-1) === '') greetings.pop();
  const card: Card = {
    name: text(data.name),
    nickname: text(data.nickname) || null,
    description: text(data.description),
    personality: text(data.personality),
    scenario: text(data.scenario),
    greetings,
    exampleDialogue: text(data.mes_example),
    systemPrompt: text(data.system_prompt),
    postHistoryInstructions: text(data.post_history_instructions),
    creatorNotes: text(data.creator_notes),
    creator: text(data.creator),
    version: typeof data.character_version === 'number' ? String(data.character_version) : text(data.character_version),
    tags: strings(data.tags),
    variables: variables(risu.defaultVariables),
    utility: risu.utilityBot === true,
    bias: list(risu.bias)
      .filter((pair): pair is [string, number] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'number')
      .map(([key, value]): [string, number] => [key, value]),
    ...pack,
    loreSettings: {
      scanDepth: count(book.scan_depth),
      tokenBudget: count(book.token_budget),
      recursive: flag(book.recursive_scanning),
      fullWordMatching: flag(record(book.extensions).risu_fullWordMatching),
    },
  };
  const { lore, loreFolders } =
    nativeLore !== null ? nativeLorebook(nativeLore)
      : module && Array.isArray(module.lorebook) ? nativeLorebook(module.lorebook) : bookLorebook(list(book.entries));
  countInText(card, lore, tally);
  return { card, lore, loreFolders, spec, icon: icon && text(icon.uri), assets };
}

export type Unstamped<S> = S extends unknown ? Omit<S, 'id'> : never;
type Stamped<S> = S & { id: string };

// A script without an id, just read or stored before scripts had ids, takes its place in its list as its id. Derived,
// never random: every device, and every read of an old backup, gives one script the same id (runtime/upgrade).
export function stampIds<R extends object, T extends object>(pack: { regex: readonly R[]; triggers: readonly T[] }): { regex: Stamped<R>[]; triggers: Stamped<T>[] } {
  const stamp = <S extends object>(scripts: readonly S[], list: string) =>
    scripts.map((script, place) => (isRecord(script) && typeof script.id !== 'string' ? { ...script, id: `${list}-${place}` } : script) as Stamped<S>);
  return { regex: stamp(pack.regex, 'regex'), triggers: stamp(pack.triggers, 'trigger') };
}

export function readTriggers(raw: unknown): Unstamped<Trigger>[] {
  const triggers: Unstamped<Trigger>[] = [];
  for (const trigger of list(raw).map(record)) {
    const name = text(trigger.comment);
    const effects = list(trigger.effect).map(record);
    const code = effects[0]?.type === 'triggerlua' ? text(effects[0].code) : null;
    if (code === null) {
      if (effects.some((effect) => !INERT.has(effect.type))) triggers.push({ kind: 'blocks', name, on: text(trigger.type), conditions: blockConditions(trigger.conditions), effects: blockEffects(trigger.effect) });
    } else if (code.trim()) triggers.push({ kind: 'lua', name, code });
  }
  return triggers;
}

// Strip only closed style blocks/comments. After an unmatched opener, stop seeking that kind's closer:
// a global non-greedy regex would rescan the remaining input for every later opener.
export function withoutStyles(html: string): string {
  const opener = /<style\b|<!--/gi;
  const closers = { style: /<\/style\s*>/gi, comment: /-->/g };
  const open = new Set<keyof typeof closers>();
  let kept = '';
  let from = 0;
  for (let found = opener.exec(html); found; found = opener.exec(html)) {
    const kind = found[0] === '<!--' ? 'comment' : 'style';
    if (open.has(kind)) continue;
    const closer = closers[kind];
    closer.lastIndex = opener.lastIndex;
    if (!closer.exec(html)) {
      open.add(kind);
      continue;
    }
    kept += html.slice(from, found.index);
    from = opener.lastIndex = closer.lastIndex;
  }
  return kept + html.slice(from);
}

function packOf(raw: { regex: unknown; trigger: unknown; background: unknown; toggles: unknown }, tally: Tally): Pack {
  const triggers = readTriggers(raw.trigger);
  const background = text(raw.background);
  if (/<(?!style\b)[a-z]/i.test(withoutStyles(background))) add(tally, 'background-html');
  const toggles = readToggles(text(raw.toggles));
  add(tally, 'toggle-line', toggles.filter((line) => line.kind === 'unread').length);
  return { ...stampIds({ regex: regexScripts(list(raw.regex), tally), triggers }), ...(background.trim() ? { background } : {}), toggles };
}

// Writers invert these readers. Charx puts scripts/lore in module.risum and the rest in card.json
// (Risu exportCharacterCard, ca1345fc); native bookVersion 2 prevents lore migration on reimport.
export const regexSource = ({ name, find, replace, stage, flags }: Unstamped<RegexScript>): Json => ({
  comment: name, in: find, out: replace, type: [...STAGES].find(([, each]) => each === stage)![0], ableFlag: flags !== null, flag: flags ?? '',
});

// Risu's editor starts a Lua trigger at 'start'; Risu runs it at every event whatever its type.
export const triggerSource = (trigger: Unstamped<Trigger>): Json =>
  trigger.kind === 'lua'
    ? { comment: trigger.name, type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: trigger.code }] }
    : { comment: trigger.name, type: trigger.on, conditions: conditionSources(trigger.conditions), effect: effectSources(trigger.effects) };

export const folderKey = (folder: number) => `folder-${folder}`;

// The native form has no enabled, priority or position, and joins keys into one string: an entry it cannot hold whole
// (nativeHolds) is kept apart by the caller.
export function lorebookSource(lore: LoreEntry[], folders: string[]): Json[] {
  const book = (entry: Json) => ({ content: '', mode: 'normal', insertorder: DEFAULT_ORDER, alwaysActive: false, selective: false, useRegex: false, bookVersion: 2, ...entry });
  return [
    ...folders.map((name, folder) => book({ key: folderKey(folder), secondkey: '', comment: name, mode: 'folder' })),
    ...lore.map((entry) =>
      book({
        key: entry.keys.join(','),
        secondkey: entry.secondaryKeys.join(','),
        comment: entry.name,
        content: entry.content,
        insertorder: entry.insertionOrder,
        alwaysActive: entry.constant,
        selective: entry.selective,
        useRegex: entry.useRegex,
        extentions: { risu_case_sensitive: entry.caseSensitive },
        ...(entry.folder !== null && { folder: folderKey(entry.folder) }),
      }),
    ),
  ];
}

// Whether nativeLorebook gives this entry back whole.
export const nativeHolds = (entry: LoreEntry) =>
  entry.enabled && entry.priority === null && entry.position === null && [entry.keys, entry.secondaryKeys].every((keys) => split(keys.join(',')).join('\0') === keys.join('\0'));

// assets: the card's icon and x-risu-asset entries. The scripts and lorebook are not in it: they go in module.risum.
// lowLevelAccess: the ruling is that a bot whose Lua triggers Risu runs is written with it on (Risu checks it before a
// trigger calls a model or the network), as the user already answered for it here.
export function cardSource(card: Card, assets: Json[], extensions: Json, lowLevelAccess: boolean): Json {
  const [first = '', ...alternate] = card.greetings;
  const { scanDepth, tokenBudget, recursive, fullWordMatching } = card.loreSettings;
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: card.name,
      nickname: card.nickname ?? '',
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: first,
      alternate_greetings: alternate,
      group_only_greetings: [],
      mes_example: card.exampleDialogue,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      creator_notes: card.creatorNotes,
      creator: card.creator,
      character_version: card.version,
      tags: card.tags,
      character_book: {
        ...(scanDepth !== null && { scan_depth: scanDepth }),
        ...(tokenBudget !== null && { token_budget: tokenBudget }),
        ...(recursive !== null && { recursive_scanning: recursive }),
        extensions: fullWordMatching === null ? {} : { risu_fullWordMatching: fullWordMatching },
        entries: [],
      },
      extensions: {
        risuai: {
          bias: card.bias,
          utilityBot: card.utility,
          defaultVariables: card.variables.map(([key, value]) => `${key}=${value}`).join('\n'),
          toggles: writeToggles(card.toggles),
          ...(card.background !== undefined && { backgroundHTML: card.background }),
          ...(lowLevelAccess && { lowLevelAccess: true }),
        },
        ...extensions,
      },
      assets,
    },
  };
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
export const extensionOf = (type: string) => EXTENSIONS[type] ?? 'png';

export type ConvertedModule = Omit<ImportedModule, 'assets' | 'unsupported'> & { assets: string[] };

// A Risu module as RisuModule holds it (src/ts/process/modules.ts), without its pictures. Its lowLevelAccess is not
// kept: what its scripts may do is the user's answer, as for a card (design §6.8).
export function convertModule(raw: Json, tally: Tally): ConvertedModule {
  const pack = packOf({ regex: raw.regex, trigger: raw.trigger, background: raw.backgroundEmbedding, toggles: raw.customModuleToggle }, tally);
  const { lore, loreFolders } = nativeLorebook(list(raw.lorebook));
  countTags([...pack.regex.flatMap((script) => [script.find, script.replace]), pack.background ?? '', ...lore.map((entry) => entry.content)], tally);
  // Neither runs here (design §6.10: a module reaches no network; Risu itself never reads cjs), so neither is kept.
  if (isRecord(raw.mcp)) add(tally, 'mcp');
  if (text(raw.cjs).trim()) add(tally, 'cjs');
  return {
    name: text(raw.name),
    description: text(raw.description),
    namespace: text(raw.namespace).trim() || null,
    risu: text(raw.id) || null,
    pack,
    lore,
    loreFolders,
    assets: list(raw.assets).map((asset) => (Array.isArray(asset) ? text(asset[0]) : '')),
  };
}

// Tavern v1, including the char_* names of older exports that Risu's JSON check accepts.
function tavern(raw: Json): Json | null {
  const name = raw.name ?? raw.char_name;
  const description = raw.description ?? raw.char_persona;
  const greeting = raw.first_mes ?? raw.char_greeting;
  if (typeof name !== 'string' || typeof description !== 'string' || typeof greeting !== 'string') return null;
  return {
    name,
    description,
    personality: raw.personality,
    scenario: raw.scenario ?? raw.world_scenario,
    first_mes: greeting,
    mes_example: raw.mes_example ?? raw.example_dialogue,
  };
}

// CCv3: the icon named main, else the first icon.
function pickIcon(assets: unknown[]): Json | null {
  const icons = assets.filter((asset): asset is Json => isRecord(asset) && asset.type === 'icon');
  return icons.find((asset) => asset.name === 'main') ?? icons[0] ?? null;
}

// Header, comment and indent blocks do nothing on their own; most bots carry an empty pair of such triggers.
const INERT = new Set<unknown>(['v2Header', 'v2Comment', 'v2EndIndent']);

// Each line splits at its first '='; Risu cuts the value at a second '='. `key=` keeps '' as the
// default, where Risu drops the line.
function variables(value: unknown): [string, string][] {
  return text(value)
    .split(/\r?\n/)
    .flatMap((line): [string, string][] => {
      const at = line.indexOf('=');
      return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
    });
}

// Switching a script off in Risu replaces its stage with 'disabled' (RegexData.svelte), so its stage is lost and it
// cannot come in as off; it is counted, as is a script on a stage risu-alpha does not run (edittrans).
export function regexScripts<K>(scripts: unknown[], tally: Tally<K | 'regex-off' | 'regex-stage'>): Unstamped<RegexScript>[] {
  return scripts.filter(isRecord).flatMap((script) => {
    const stage = STAGES.get(script.type);
    if (!stage) {
      add(tally, script.type === 'disabled' ? 'regex-off' : 'regex-stage');
      return [];
    }
    return [{ name: text(script.comment), find: text(script.in), replace: text(script.out), stage, flags: (script.ableFlag === true && text(script.flag)) || null }];
  });
}

type LoreSource = { folderId(raw: Json): string; name(raw: Json): string; entry(raw: Json): Entry };

// A folder is an entry with mode 'folder'; the entries in it name its key (lorebook.svelte.ts:45-73).
function lorebook(raws: unknown[], source: LoreSource): { lore: LoreEntry[]; loreFolders: string[] } {
  const entries = raws.filter(isRecord);
  const folders = new Map<string, number>();
  const loreFolders: string[] = [];
  for (const raw of entries.filter((raw) => raw.mode === 'folder')) {
    folders.set(source.folderId(raw), loreFolders.length);
    loreFolders.push(source.name(raw));
  }
  const lore = entries
    .filter((raw) => raw.mode !== 'folder')
    .map((raw) => ({ name: source.name(raw), ...source.entry(raw), folder: folders.get(text(raw.folder)) ?? null }));
  return { lore, loreFolders };
}

const nativeLorebook = (entries: unknown[]) => lorebook(entries, risuLore(true));

// A CCv3 character_book's entries, in a card or a file of their own.
export const bookLorebook = (entries: unknown[]) => lorebook(entries, BOOK_LORE);

// A Risu chat's own lorebook (localLore), and an entry a bot writes to it. Never migrated: Risu's open-time migration
// (characterFormatUpdate) runs over globalLore only, and these entries carry no bookVersion.
export const chatLorebook = (entries: unknown[]) => lorebook(entries, risuLore(false));

// Native module and backup lore share bookVersion: only version 1's activationPercent and old tag syntax migrate.
const risuLore = (migrates: boolean): LoreSource => ({
  folderId: (raw) => text(raw.key),
  name: (raw) => text(raw.comment),
  entry: (raw) => ({
    keys: split(raw.key),
    secondaryKeys: split(raw.secondkey),
    content: !migrates || (typeof raw.bookVersion === 'number' && raw.bookVersion >= 2) ? text(raw.content) : migrate(text(raw.content), raw.activationPercent),
    // Risu's own lore has no enabled flag.
    enabled: true,
    constant: raw.alwaysActive === true,
    selective: raw.selective === true,
    useRegex: raw.useRegex === true,
    caseSensitive: record(raw.extentions).risu_case_sensitive === true,
    insertionOrder: order(raw.insertorder),
    priority: null,
    position: null,
  }),
});

const BOOK_LORE: LoreSource = {
  folderId: (raw) => keys(raw.keys)[0] ?? '',
  name: (raw) => text(raw.name) || text(raw.comment),
  entry: (raw) => {
    const extensions = record(raw.extensions);
    const secondaryKeys = keys(raw.secondary_keys);
    let selective = raw.selective === true;
    let content = text(raw.content);
    const prepend = (line: string) => {
      content = `${line}\n${content}`;
    };
    // SillyTavern's entry extensions become decorators, prepended in Risu's order (characterCards.ts:1065-1119).
    if (extensions.useProbability === true && typeof extensions.probability === 'number' && extensions.probability !== 100) {
      prepend(`@@probability ${extensions.probability}`);
    }
    const role = typeof extensions.role === 'number' ? ROLES[extensions.role] : undefined;
    if (extensions.position === 4 && typeof extensions.depth === 'number' && role) prepend(`@@depth ${extensions.depth}\n@@role ${role}`);
    switch (secondaryKeys.length > 0 ? extensions.selectiveLogic : undefined) {
      case 1:
        selective = false;
        prepend(`@@exclude_keys_all ${secondaryKeys.join(',')}`);
        break;
      case 2:
        selective = false;
        for (const key of secondaryKeys) prepend(`@@exclude_keys ${key}`);
        break;
      case 3:
        selective = false;
        for (const key of secondaryKeys) prepend(`@@additional_keys ${key}`);
        break;
    }
    if (typeof extensions.delay === 'number' && extensions.delay > 0) prepend(`@@activate_only_after ${extensions.delay}`);
    if (typeof extensions.match_whole_words === 'boolean') prepend(extensions.match_whole_words ? '@@match_full_word' : '@@match_partial_word');
    return {
      keys: keys(raw.keys),
      secondaryKeys,
      content: migrate(content, extensions.risu_activationPercent),
      // Honored; Risu drops enabled and never reads case_sensitive.
      enabled: raw.enabled !== false,
      caseSensitive: raw.case_sensitive === true,
      constant: raw.constant === true,
      selective,
      useRegex: raw.use_regex === true,
      insertionOrder: order(raw.insertion_order),
      priority: finite(raw.priority),
      position: raw.position === 'before_char' || raw.position === 'after_char' ? raw.position : null,
    };
  },
};

// Risu's one-time lore migration (updateLorebooks, characters.ts:648-663).
// @@end is matched as a whole decorator: Risu's unanchored pattern also rewrites text such as "@@endless".
function migrate(content: string, percent: unknown): string {
  const probability = typeof percent === 'number' && Number.isFinite(percent) && percent !== 0 ? `@@probability ${percent}\n` : '';
  return (probability + content)
    .replace(/^@@@?end(?=[ \t\r]|$)/gm, '@@depth 0')
    .replace(/<(char|bot)>/g, '{{char}}')
    .replace(/<user>/g, '{{user}}');
}

// Unsupported content inside text stays verbatim; it is only counted.
function countInText(card: Card, lore: LoreEntry[], tally: Tally) {
  const texts = [
    card.description,
    card.personality,
    card.scenario,
    ...card.greetings,
    card.exampleDialogue,
    card.systemPrompt,
    card.postHistoryInstructions,
    ...card.bias.map(([key]) => key),
    ...card.regex.flatMap((script) => [script.find, script.replace]),
    card.background ?? '',
    ...lore.map((entry) => entry.content),
  ];
  countTags(texts, tally);
  for (const entry of lore) add(tally, 'disable-ui-prompt', parseDecorators(entry.content).decorators.filter(({ name }) => name === 'disable_ui_prompt').length);
}

export function countTags(texts: string[], tally: Tally) {
  for (const value of texts) {
    for (const [, name] of value.matchAll(/\{\{([^{}:]*)/g)) {
      if (isUnsupportedTag(name!)) add(tally, 'cbs-tag');
    }
  }
}
