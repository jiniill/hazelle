import { gzipSync } from 'fflate';
import { isRecord, list } from '../../connectors/values';
import type { Block, ChatRange, ConversationPrompt, Role, SLOTS, SlotKind, TextBlock } from '../../model/prompt';
import { args } from '../lorebook/decorators';
import { add, counted, record, regexScripts, stampIds, text, type Json, type Tally } from './convert';
import { expansionLimit, gunzip, TooLarge } from './inflate';
import { readMsgpack, writeMsgpack } from './msgpack';
import { pack, unpack } from './risum';
import { readToggles, writeToggles } from './toggles';
import type { RegexScript } from './types';

// What a preset holds that the prompt does not take, in the order the summary lists it.
const UNSUPPORTED = ['jailbreak', 'cot', 'chatml', 'cache-narrowed', 'unread-item', 'repeated-slot', 'toggle-line', 'preset-text', 'regex-off', 'regex-stage', 'variables', 'prompt-settings', 'settings'] as const;
export type PresetUnsupportedKind = (typeof UNSUPPORTED)[number];
type Counted = Exclude<PresetUnsupportedKind, 'repeated-slot'>;
// A repeated slot is listed once per slot, so the summary can name it.
export type PresetUnsupported = { kind: Counted; count: number } | { kind: 'repeated-slot'; slot: SlotKind; count: number };

// unreadable: not RPack'd gzip'd MessagePack. not-preset: a Risu container of another type. decrypt-failed:
// the preset inside does not open. no-template: a legacy preset, which risu-alpha does not assemble.
export type PresetFailure = { kind: 'unreadable' | 'not-preset' | 'decrypt-failed' | 'no-template'; detail?: string };
// regex: the preset's scripts, which a prompt cannot hold; saving puts them in a module on for the prompt.
export type PresetRead = { prompt: ConversationPrompt; regex: RegexScript[]; unsupported: PresetUnsupported[] };
export type PresetResult = ({ ok: true } & PresetRead) | { ok: false; failure: PresetFailure };

const ROLES = new Map<unknown, Role>([
  ['system', 'system'],
  ['user', 'user'],
  ['bot', 'assistant'],
]);
const MARKS = new Map<unknown, TextBlock['mark']>([
  ['normal', null],
  ['main', 'main'],
  ['globalNote', 'globalNote'],
]);
const WRAPPED = new Map<unknown, 'description' | 'persona' | 'authorNote' | 'memory'>([
  ['description', 'description'],
  ['persona', 'persona'],
  ['authornote', 'authorNote'],
  ['memory', 'memory'],
]);
const SKIPPED = new Map<unknown, Counted>([
  ['jailbreak', 'jailbreak'],
  ['cot', 'cot'],
  ['chatML', 'chatml'],
]);
// A slot placed again where the model allows it once keeps its first place; SLOTS decides which repeat.
type Repeating = { [K in SlotKind]: (typeof SLOTS)[K]['repeats'] extends true ? K : never }[SlotKind];
const REPEATING: Record<Repeating, true> = { chat: true, description: true, persona: true };

const fail = (kind: PresetFailure['kind']): PresetResult => ({ ok: false, failure: { kind } });

const presetKey = async (usage: 'encrypt' | 'decrypt') => crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode('risupreset')), 'AES-GCM', false, [usage]);
const SEAL = { name: 'AES-GCM', iv: new Uint8Array(12) };

// Risu's preset container (compat spec, out-of-scope formats), told apart by extension as Risu does: a .risup is
// RPack over gzip, a .risupreset gzip alone. Inside is MessagePack {type: 'preset', preset}, where preset is
// MessagePack under AES-GCM; presetVersion 0 names the field pres. The key is SHA-256 of a fixed string and the IV
// is zero: the format hides the preset from casual reading, it does not protect it.
export async function importPreset(fileName: string, bytes: Uint8Array): Promise<PresetResult> {
  if (!isPresetFile(fileName)) return fail('unreadable');
  const packed = fileName.toLowerCase().endsWith('.risup');
  let outer: unknown;
  try {
    outer = readMsgpack(gunzip(packed ? unpack(bytes) : bytes, expansionLimit(bytes.length)));
  } catch (error) {
    return error instanceof TooLarge ? { ok: false, failure: { kind: 'unreadable', detail: error.message } } : fail('unreadable');
  }
  const sealed = isRecord(outer) ? (outer.preset ?? outer.pres) : null;
  if (!isRecord(outer) || outer.type !== 'preset' || !(sealed instanceof Uint8Array)) return fail('not-preset');
  let opened: ArrayBuffer;
  try {
    opened = await crypto.subtle.decrypt(SEAL, await presetKey('decrypt'), sealed.slice());
  } catch {
    return fail('decrypt-failed');
  }
  let preset: unknown;
  try {
    preset = readMsgpack(new Uint8Array(opened));
  } catch {
    return fail('unreadable');
  }
  return convertPreset(preset);
}

// Ruling 9 (user, 2026-10-15): Risu's setPreset reads each of these as `preset.x ?? current`, so null keeps the user's
// own model, sampler and API settings on selection; left out, Risu's preset template default would replace them.
// Never add a field setPreset reads without ?? (repetition_penalty, min_p, top_a, localStopStrings): null would be
// stored as is. top_p resets to 1 whatever is written (export spec §3).
const KEPT_IN_RISU = [
  'apiType', 'aiModel', 'subModel', 'currentPluginProvider', 'temperature', 'maxContext', 'maxResponse', 'frequencyPenalty', 'PresensePenalty', 'top_k', 'bias',
  'textgenWebUIStreamURL', 'textgenWebUIBlockingURL', 'forceReplaceUrl', 'koboldURL', 'proxyKey', 'proxyRequestModel', 'openrouterRequestModel', 'ooba', 'ainconfig', 'NAISettings',
  'localNetworkMode', 'localNetworkTimeoutSec',
];
const ROLES_OUT = new Map([...ROLES].map(([risu, role]) => [role, risu]));
const WRAPPED_OUT = new Map<SlotKind, unknown>([...WRAPPED].map(([risu, slot]) => [slot, risu]));

// tools: the 도구 slots left out, which Risu has no item for.
export type PresetWritten = { bytes: Uint8Array<ArrayBuffer>; tools: number };

// A .risup as Risu's downloadPreset writes it, the container importPreset reads. namespaces: those of the modules on
// for the prompt, which go to moduleIntergration after the companions its own preset named.
export async function writePreset(prompt: ConversationPrompt, namespaces: readonly string[]): Promise<PresetWritten> {
  const { preset, tools } = botPreset(prompt, namespaces);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(SEAL, await presetKey('encrypt'), writeMsgpack(preset)));
  return { bytes: pack(gzipSync(writeMsgpack({ presetVersion: 2, type: 'preset', preset: sealed }))), tools };
}

export function botPreset(prompt: ConversationPrompt, namespaces: readonly string[]): { preset: Json; tools: number } {
  const promptTemplate: Json[] = [];
  let tools = 0;
  for (const block of prompt.blocks) {
    const item = templateItem(block, prompt.authorNote);
    if (item) promptTemplate.push(item);
    else tools++;
    if (block.cache) promptTemplate.push({ type: 'cache', name: '', depth: 1, role: 'all' });
  }
  const integration = [...new Set([...(prompt.companions ?? []), ...namespaces])].join(',');
  return {
    preset: { ...Object.fromEntries(KEPT_IN_RISU.map((field) => [field, null])), name: prompt.name, promptTemplate, customPromptTemplateToggle: writeToggles(prompt.toggles), moduleIntergration: integration },
    tools,
  };
}

// The inverse of block(): a wrapped item's role goes in role2, where current Risu reads it.
function templateItem(block: Block, authorNote: string): Json | null {
  const name = block.name ?? undefined;
  if (block.kind === 'text') return { type: 'plain', type2: block.mark ?? 'normal', text: block.text, role: ROLES_OUT.get(block.role), name };
  switch (block.slot) {
    case 'lorebook':
    case 'postEverything':
      return { type: block.slot, name };
    case 'chat':
      return { type: 'chat', rangeStart: block.range.from, rangeEnd: block.range.to ?? 'end', name };
  }
  const type = WRAPPED_OUT.get(block.slot);
  if (type === undefined) return null;
  return { type, innerFormat: block.wrapper ?? undefined, role2: ROLES_OUT.get(block.role), name, ...(type === 'authornote' && { defaultText: authorNote }) };
}

export const PRESET_EXTENSIONS = ['.risup', '.risupreset'];
export const isPresetFile = (fileName: string) => PRESET_EXTENSIONS.some((extension) => fileName.toLowerCase().endsWith(extension));

// A Risu preset object, as a .risup holds it and as a backup's botPresets lists it.
export function convertPreset(preset: unknown): PresetResult {
  if (!isRecord(preset)) return fail('unreadable');
  if (!Array.isArray(preset.promptTemplate)) return fail('no-template');
  return { ok: true, ...convert(preset, preset.promptTemplate) };
}

function convert(preset: Json, template: unknown[]): PresetRead {
  const counts: Tally<Counted> = new Map();
  const count = (kind: Counted, amount = 1) => add(counts, kind, amount);
  const repeated: Tally<SlotKind> = new Map();
  const blocks: Block[] = [];
  const placed = new Set<SlotKind>();
  let authorNote = '';
  for (const item of template) {
    if (!isRecord(item)) {
      count('unread-item');
      continue;
    }
    // Risu's cache item marks the last `depth` messages before it, of one role or of all; 여기까지 캐시 on the block
    // before it marks the one message before it, which is Risu's depth 1 over all roles. One at the top marks nothing
    // in Risu either.
    if (item.type === 'cache') {
      if (!(item.depth === 1 && item.role === 'all')) count('cache-narrowed');
      const before = blocks.at(-1);
      if (before) blocks[blocks.length - 1] = { ...before, cache: true };
      continue;
    }
    const read = block(item);
    if (typeof read === 'string') {
      count(read);
      continue;
    }
    if (read.kind === 'slot' && !Object.hasOwn(REPEATING, read.slot)) {
      if (placed.has(read.slot)) {
        add(repeated, read.slot);
        continue;
      }
      placed.add(read.slot);
      if (read.slot === 'authorNote') authorNote = text(item.defaultText);
    }
    blocks.push(read);
  }

  const toggles = readToggles(text(preset.customPromptTemplateToggle));
  count('toggle-line', toggles.filter((line) => line.kind === 'unread').length);
  // A template preset sends none of these texts (compat spec, legacy-only buckets); its jailbreak goes only
  // through a jailbreak item, counted above.
  count('preset-text', [preset.mainPrompt, preset.jailbreak, preset.globalNote].filter((value) => text(value).trim()).length);
  const { regex } = stampIds({ regex: regexScripts(list(preset.regex), counts), triggers: [] });
  // They default chat variables (getvar), not toggles, which are globals with no default (compat spec §d).
  count('variables', text(preset.templateDefaultVariables).split(/\r?\n/).filter((line) => line.trim()).length);
  count('prompt-settings', promptSettings(record(preset.promptSettings), template));
  // Model and generation settings belong to each model's settings; every preset has them.
  count('settings');

  const companions = args(text(preset.moduleIntergration));
  // Preset model names are not this account's connections, so the prompt's model layer starts empty.
  return {
    prompt: { name: text(preset.name), blocks, toggles, authorNote, models: {}, imported: 'risu-preset', ...(companions.length > 0 && { companions }) },
    regex,
    unsupported: UNSUPPORTED.flatMap((kind): PresetUnsupported[] => (kind === 'repeated-slot' ? [...repeated].map(([slot, amount]) => ({ kind, slot, count: amount })) : counted([kind], counts))),
  };
}

// Risu's prompt settings (process/prompt.ts PromptSettings) that this app has no setting for, each counted only off its
// default (storage/database.svelte.ts:438-449). Not counted on purpose: assistantPrefill, which Risu never reads, and
// trimStartNewChat and customChainOfThought, which only leave out what this app never sends ([Start a new chat], Risu's
// own CoT instruction).
function promptSettings(settings: Json, template: unknown[]): number {
  // A chat item marked chatAsOriginalOnSystem keeps its messages' roles, as every chat slot here does.
  const systemized = settings.sendChatAsSystem === true && template.some((item) => isRecord(item) && item.type === 'chat' && item.chatAsOriginalOnSystem !== true);
  const depth = typeof settings.maxThoughtTagDepth === 'number' && settings.maxThoughtTagDepth !== -1;
  return [text(settings.postEndInnerFormat) !== '', systemized, settings.sendName === true, settings.utilOverride === true, depth].filter(Boolean).length;
}

// One template item (compat spec §e, Template assembly). Fields a type does not use, such as a persona
// item's range, are ignored.
function block(item: Json): Block | Counted {
  const skipped = SKIPPED.get(item.type);
  if (skipped) return skipped;
  const named = { id: crypto.randomUUID(), name: text(item.name) || null };
  const role = ROLES.get(item.role);
  const wrapped = WRAPPED.get(item.type);
  if (wrapped) {
    // The role on these is an optional override of the bucket's, which is system (compat spec, Template assembly).
    // Current Risu keeps it in `role2`; older editors wrote `role` (export spec, Finding: role2).
    const override = item.role2 ?? item.role;
    const placedAs = override === undefined ? 'system' : ROLES.get(override);
    return placedAs ? { ...named, kind: 'slot', slot: wrapped, role: placedAs, wrapper: text(item.innerFormat) || null } : 'unread-item';
  }
  switch (item.type) {
    case 'plain': {
      const mark = MARKS.get(item.type2);
      return role && mark !== undefined && typeof item.text === 'string' ? { ...named, kind: 'text', role, text: item.text, mark } : 'unread-item';
    }
    case 'lorebook':
    case 'postEverything':
      return { ...named, kind: 'slot', slot: item.type };
    case 'chat': {
      const range = chatRange(item.rangeStart, item.rangeEnd);
      return range ? { ...named, kind: 'slot', slot: 'chat', range } : 'unread-item';
    }
  }
  return 'unread-item';
}

// Risu slices [rangeStart, rangeEnd): negative counts from the end, 'end' is the end, and -1000 means all,
// read here as the far end on either side.
function chatRange(start: unknown, end: unknown): ChatRange | null {
  const from = start === -1000 ? 0 : start;
  const to = end === 'end' || end === -1000 ? null : end;
  if (typeof from !== 'number' || !Number.isInteger(from)) return null;
  if (to !== null && (typeof to !== 'number' || !Number.isInteger(to))) return null;
  return { from, to };
}
