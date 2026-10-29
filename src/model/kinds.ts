import type { Connection } from '../connectors/types';
import type { CachePrint } from './cache';
import type { Chat, Entry, Summary } from './chat';
import type { Folder } from './folders';
import type { Asset, Avatar, Character, Inlay, Lore, Module, TextFile } from './library';
import type { Illustration } from './illustration';
import type { Likeness } from './likeness';
import type { Remark } from './mascot';
import { ORDER_ID, type Order } from './order';
import type { Memory, Vectors } from './memory';
import type { Persona } from './persona';
import type { Profile } from './profile';
import type { Share } from './share';
import type { Prompt } from './prompt';
import { SETTINGS_ID, type Settings } from './settings';
import type { Tool, ToolChatData, ToolData, ToolDraft, ToolFile } from './tool';
import type { Stream } from './stream';
import type { Ledger } from './usage';

export type Values = {
  character: Character;
  module: Module;
  tool: Tool;
  tooldraft: ToolDraft;
  tooldata: ToolData;
  toolfile: ToolFile;
  toolchat: ToolChatData;
  folder: Folder;
  lore: Lore;
  avatar: Avatar;
  asset: Asset;
  likeness: Likeness;
  share: Share;
  // A chat's own picture, attached in the composer or brought from Risu's inlay store: never one of its card's assets.
  inlay: Inlay;
  textfile: TextFile;
  chat: Chat;
  entry: Entry;
  summary: Summary;
  stream: Stream;
  memory: Memory;
  vectors: Vectors;
  cacheprint: CachePrint;
  illustration: Illustration;
  remark: Remark;
  connection: Connection;
  settings: Settings;
  order: Order;
  ledger: Ledger;
  prompt: Prompt;
  persona: Persona;
  profile: Profile;
};
export type Kind = keyof Values;

// parent is immutable, cleartext and bound into sealing; use owner for sealed ownership links.
// Singleton ids and appendOnly constrain writes; file metadata drives backup discovery.
export type Rule = { parent: Kind | readonly Kind[] | null; id?: string; appendOnly?: true; file?: true; owner?: { field: string; kind: Kind } };

type Link<K extends Kind> = { [F in keyof Values[K]]-?: Values[K][F] extends string | null ? F : never }[keyof Values[K]];

export const KINDS = {
  character: { parent: null },
  module: { parent: null },
  tool: { parent: 'module', file: true },
  tooldraft: { parent: null },
  tooldata: { parent: 'module' },
  toolfile: { parent: 'module', file: true },
  toolchat: { parent: 'chat', owner: { field: 'module', kind: 'module' } },
  folder: { parent: null },
  lore: { parent: ['character', 'module', 'chat'] },
  avatar: { parent: 'character', file: true },
  asset: { parent: ['character', 'module'], file: true },
  likeness: { parent: ['character', 'module', 'persona'] },
  share: { parent: 'character' },
  chat: { parent: null, owner: { field: 'character', kind: 'character' } },
  entry: { parent: 'chat', appendOnly: true },
  summary: { parent: 'chat' },
  stream: { parent: 'chat' },
  memory: { parent: 'chat' },
  vectors: { parent: 'chat' },
  cacheprint: { parent: 'chat' },
  illustration: { parent: 'chat', file: true },
  remark: { parent: 'chat' },
  inlay: { parent: 'chat', file: true },
  textfile: { parent: 'chat' },
  connection: { parent: null },
  settings: { parent: null, id: SETTINGS_ID },
  order: { parent: null, id: ORDER_ID },
  ledger: { parent: 'settings', appendOnly: true },
  prompt: { parent: null },
  persona: { parent: null },
  profile: { parent: null },
} as const satisfies Record<Kind, Rule> & { [K in Kind]: { owner?: { field: Link<K> } } };

export const FILE_KINDS = (Object.keys(KINDS) as Kind[]).filter((kind) => 'file' in KINDS[kind]);

export function parentKinds(kind: Kind): readonly Kind[] {
  const { parent }: Rule = KINDS[kind];
  return parent === null ? [] : typeof parent === 'string' ? [parent] : parent;
}

export type Singleton = { [K in Kind]: (typeof KINDS)[K] extends { id: string } ? K : never }[Kind];
export type AppendOnly = { [K in Kind]: (typeof KINDS)[K] extends { appendOnly: true } ? K : never }[Kind];

type Check = (value: unknown) => boolean;
const str: Check = (value) => typeof value === 'string';
const num: Check = (value) => typeof value === 'number';
const bool: Check = (value) => typeof value === 'boolean';
// connectors/values isRecord, which the model may not import (eslint/boundaries.js).
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const orNull = (check: Check): Check => (value) => value === null || check(value);
const listOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check);
const shape = (fields: Record<string, Check>): Check => (value) => isRecord(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const all = (check: Check, ...fields: string[]) => Object.fromEntries(fields.map((field) => [field, check]));

const finite: Check = (value) => typeof value === 'number' && Number.isFinite(value);
const nonnegative: Check = (value) => finite(value) && (value as number) >= 0;
const measurement: Check = (value) => isRecord(value) && (value.kind === 'unavailable'
  ? ['historical', 'preparation', 'tokenizer'].includes(String(value.reason))
  : value.kind === 'measured' && shape({ key: str, at: finite, fingerprint: str, o200k: nonnegative, messages: nonnegative, blocks: nonnegative, pictures: nonnegative })(value));
const calibration = shape({
  measurement,
  fit: orNull(shape({ source: str, evidence: nonnegative, bound: orNull(str), multiplier: orNull(nonnegative), allowance: orNull(nonnegative), inputLimit: orNull(nonnegative), epsilon: finite })),
  retries: listOf(shape({ measurement, actual: orNull(nonnegative), maximum: orNull(nonnegative), allowance: nonnegative, at: finite })),
  eligible: bool,
  refusal: (value) => value === undefined || shape({ actual: orNull(nonnegative), maximum: orNull(nonnegative) })(value),
});

const text = { at: num, text: str, receipt: orNull(isRecord) };
const ENTRIES = {
  message: shape({ role: str, ...text }),
  version: shape({ message: str, replaces: orNull(str), edit: bool, ...text }),
  select: shape({ message: str, version: str, at: num }),
  delete: shape({ message: str, at: num }),
  restore: shape({ message: str, at: num }),
  cost: shape({ replyId: str, cost: orNull(isRecord), at: num }),
  translation: shape({ version: str, ...text }),
  vars: shape({ version: str, set: listOf(Array.isArray), at: num }),
  call: shape({ version: str, receipt: isRecord, at: num }),
  follow: shape({ message: str, follows: str, at: num }),
  agentMemory: shape({ version: str, agent: str, memory: str, at: num }),
} satisfies Record<Entry['type'], Check>;

const picture = shape({ name: str, type: str, size: num, file: shape({ id: str, key: str }) });
const toggle = shape({ key: str, label: str, kind: str });
const mark = shape({ label: str });
const unread = shape({ text: str });
const toggleLine: Check = (value) =>
  isRecord(value) && (value.kind === 'groupEnd' || (value.kind === 'divider' || value.kind === 'caption' || value.kind === 'group' ? mark : value.kind === 'unread' ? unread : toggle)(value));
const prompt = shape({ name: str, blocks: listOf(shape({ id: str, kind: str })), toggles: listOf(toggleLine) });
const optStr: Check = (value) => value === undefined || str(value);
const conversation = shape({ task: (value) => value === undefined, authorNote: str, models: isRecord, folder: optStr });
const task = shape({ task: (value) => value === 'translate' || value === 'memory' || value === 'illustrate' || value === 'mascot' || value === 'preread' || value === 'agent', model: (value) => value === undefined || isRecord(value) });

const BASE64 = /^(?=.)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const SHAPES = {
  character: shape({
    card: shape({
      ...all(str, 'name', 'description', 'personality', 'scenario', 'exampleDialogue', 'systemPrompt', 'postHistoryInstructions'),
      ...all(str, 'creatorNotes', 'creator', 'version'),
      toggles: listOf(toggleLine),
      nickname: orNull(str),
      greetings: listOf(str),
      tags: listOf(str),
      variables: listOf(Array.isArray),
      bias: listOf(Array.isArray),
      regex: listOf(shape({ id: str })),
      triggers: listOf(shape({ id: str, kind: str, name: str })),
      utility: bool,
      loreSettings: isRecord,
    }),
    folder: orNull(str),
    loreFolders: listOf(shape({ id: str, name: str })),
  }),
  module: shape({ name: str, description: str, namespace: orNull(str), folder: optStr, regex: listOf(shape({ id: str })), triggers: listOf(shape({ id: str, kind: str, name: str })), toggles: listOf(toggleLine), loreFolders: listOf(shape({ id: str, name: str })) }),
  tool: shape({ manifest: shape({ api: (value) => value === 1, ...all(str, 'name', 'author', 'displayName', 'version', 'description'), uses: listOf((value) => value === 'model' || value === 'embed' || value === 'memory' || value === 'network'), page: orNull(shape({ label: str })), menu: listOf(shape({ id: str, label: str })), settings: listOf(shape({ key: str, type: str, label: str })) }), file: shape({ id: str, key: str }), size: num, settings: isRecord }),
  tooldraft: shape({ identity: shape(all(str, 'name', 'author', 'displayName', 'version', 'description')), body: str, module: orNull(str), applied: orNull(str), asks: listOf(shape({ ask: str, note: str, model: shape(all(str, 'connection', 'model')), cost: orNull(isRecord), at: num })), at: num }),
  tooldata: shape({ key: str, value: (value) => value !== undefined }),
  toolfile: shape({ key: str, size: num, file: shape({ id: str, key: str }) }),
  toolchat: shape({ module: str, key: orNull(str), value: (value) => value !== undefined }),
  folder: shape({ name: str, of: (value) => value === undefined || value === 'prompt' || value === 'module' || value === 'persona' }),
  lore: shape({
    ...all(bool, 'enabled', 'constant', 'selective', 'useRegex', 'caseSensitive'),
    name: str,
    keys: listOf(str),
    secondaryKeys: listOf(str),
    content: str,
    insertionOrder: num,
    priority: orNull(num),
    position: orNull(str),
    folder: orNull(str),
  }),
  avatar: shape({ type: str, size: num, thumb: str, file: shape({ id: str, key: str }) }),
  asset: picture,
  likeness: shape({ portraits: listOf(shape({ ...all(str, 'name', 'look', 'artist', 'source'), aliases: listOf(str), outfits: listOf(shape(all(str, 'name', 'tags'))) })), at: num, receipt: orNull(isRecord) }),
  share: shape({ share: str, key: str }),
  inlay: (value) => picture(value) && isRecord(value) && (value.attached === undefined || value.attached === true),
  textfile: shape(all(str, 'name', 'title', 'text')),
  chat: shape({ title: orNull(str), character: orNull(str), models: isRecord, cast: (value) => value === undefined || listOf(str)(value), bookmarks: (value) => value === undefined || listOf(shape({ message: str }))(value), loreFolders: (value) => value === undefined || listOf(shape({ id: str, name: str }))(value), movedPictures: (value) => value === undefined || value === true, sendsPrompt: (value) => value === undefined || value === true }),
  entry: (value) => isRecord(value) && typeof value.type === 'string' && Object.hasOwn(ENTRIES, value.type) && ENTRIES[value.type as Entry['type']](value),
  summary: shape({ version: num, head: num, chatRev: num, dependencies: listOf(isRecord), rendered: shape({ now: num, timeZone: str }), character: orNull(str), title: str, preview: str, count: num, at: orNull(num), order: num, recent: listOf(isRecord) , stuck: (value) => value === undefined || shape({ dependencies: listOf(isRecord) })(value) }),
  // A batch's marker holds no key: no server object holds its call.
  stream: (value) => shape({ calibration, call: shape({ ...all(str, 'connection', 'source', 'model', 'modelName'), entry: optStr }), at: num, result: str, for: shape({ kind: str }) })(value) && (shape({ key: isRecord })(value) || shape({ batch: str })(value)),
  vectors: shape({ model: str, items: (value) => isRecord(value) && Object.values(value).every(shape({
    at: nonnegative,
    scale: (value) => finite(value) && (value as number) > 0 && (value as number) <= 1,
    data: (value) => typeof value === 'string' && BASE64.test(value),
  })) }),
  cacheprint: shape({ ...all(str, 'call', 'connection', 'model'), account: orNull(str), messages: listOf(shape({ role: str, hash: str, tokens: num, from: isRecord })) }),
  memory: shape({ records: listOf(shape({ id: str, sources: listOf(isRecord), print: str, what: str, state: listOf(isRecord), opens: listOf(str), closes: listOf(str) })), chapters: listOf(shape({ id: str, sources: listOf(isRecord), print: str, what: str, records: listOf(shape({ id: str, at: num })) })), state: listOf(shape(all(str, 'about', 'field', 'value'))), threads: listOf(shape({ id: str, text: str })) }),
  illustration: (value) => shape({ ...all(str, 'message', 'version', 'type'), file: shape({ id: str, key: str }), size: num, at: num })(value) && (isRecord(value) && 'tool' in value
    ? shape({ ...all(num, 'paragraph', 'width', 'height'), tool: shape(all(str, 'module', 'name')), caption: optStr })(value)
    : shape({
      scene: shape({ paragraph: num, shape: str, setting: str, framing: str, characters: listOf(shape({ ...all(str, 'name', 'look', 'outfit', 'action'), x: num, y: num })) }),
      receipt: orNull(isRecord),
      model: shape(all(str, 'connection', 'model')),
      sent: shape({ prompt: str, negative: str, characters: listOf(shape({ prompt: str, negative: str, center: shape(all(num, 'x', 'y')) })), ...all(num, 'width', 'height', 'seed') }),
    })(value)),
  remark: shape({ ...all(str, 'message', 'version', 'mascot', 'expression', 'line'), receipt: isRecord, model: shape(all(str, 'connection', 'model')), at: num }),
  connection: shape({
    type: str,
    label: str,
    baseUrl: orNull(str),
    protocol: orNull(str),
    accounts: listOf(shape({ id: str, secret: str })),
    turns: orNull(shape({ day: num, groups: listOf(shape({ id: str, name: str, accounts: listOf(str) })), anchor: shape({ group: str, cycle: num }) })),
    starred: listOf(shape({ id: str, name: str, entry: optStr, label: optStr, pictures: (value) => value === undefined || value === true })),
    retries: (value) => value === undefined || num(value),
  }),
  settings: shape({ models: isRecord }),
  order: shape({ ids: listOf(str) }),
  ledger: (value) => isRecord(value) && ((value.type === 'call' || value.type === 'input-refusal')
    ? shape({ at: num, call: shape({ ...all(str, 'id', 'connection', 'model', 'modelName', 'source'), calibration }), chat: orNull(str), character: orNull(str) })(value)
    : value.type === 'cost' && shape({ call: str, cost: orNull(isRecord), at: num })(value)),
  prompt: (value) => prompt(value) && (conversation(value) || task(value)),
  persona: shape({ name: str, description: str, picture: orNull(str), folder: optStr }),
  profile: shape({ name: str, settings: isRecord }),
} satisfies Record<Kind, Check>;

export const isValue = <K extends Kind>(kind: K, value: unknown): value is Values[K] => SHAPES[kind](value);

// pending orders unanswered tab-local writes; rev remains the replaced confirmed revision (0 for creates).
export type Stored<K extends Kind> = { id: string; kind: K; parent: string | null; rev: number; value: Values[K]; pending?: number };
