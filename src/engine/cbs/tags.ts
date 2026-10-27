import { isRecord } from '../../connectors/values';
import { UNSET } from '../script-api';
import { assetUrl, findAsset, isVideo, type BotAsset } from '../assets';
import { seeded } from '../random';
import { escapeCbs } from './escape';
import type { CbsContext } from './evaluate';
import type { HistoryMessage } from '../history';
import type { LoreEntry } from '../import/types';
import { calc } from './math';
import { calendarDate, clockTime, duration, formatTime } from './time';

export type Env = {
  context: CbsContext;
  // Whether setvar, addvar and setdefaultvar write: only in a chat message's own text.
  writes: boolean;
  temp: Map<string, string>;
  random: () => number;
  // Card, persona and prompt texts go out through this, never as they are: they hold CBS of their own, and
  // write no variables.
  insert: (text: string) => string;
  call: (name: string, args: string[]) => string | null;
  arg: (index: number) => string | null;
  slot: (name: string) => string | null;
};

// {{return}} ends the nearest parse (the whole text, a {{call}} or an inserted text) with its value.
export class Return {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
}

// Backspace/erase return edits to preceding same-level text; only evaluateNodes owns that text.
export type Erase = (before: string) => string;

// null: the tag stays as written, as it does with fewer than min arguments.
type Run = (args: string[], env: Env) => string | Erase | null;
const HANDLERS = new Map<string, { min: number; run: Run }>();

// names: the tag and its aliases, written normalized, since a name read from text is normalized first.
function define(names: string, min: number, run: Run) {
  for (const name of names.split(' ')) HANDLERS.set(name, { min, run });
}

export const normalize = (name: string) => name.toLowerCase().replace(/[\s_-]/g, '');
export const handlerFor = (name: string) => HANDLERS.get(normalize(name));
export const tagNames = () => [...HANDLERS.keys()];

// Unsupported Risu tags stay literal and are counted at import.
const UNSUPPORTED = new Set([
  // Marked X in risu-compat-spec §d, with their aliases in src/ts/cbs.ts at ca1345fc. The internal-only `__`
  // is left out, since normalizing empties its name.
  'emotionlist',
  'audio',
  'bgm',
  'bg',
  'emotion',
  'assetprompt',
  // risu-alpha prompts have no jailbreak.
  'jb',
  'jailbreak',
  'jbtoggled',
  // Marked N: declare is as written in Risu too.
  'declare',
]);

export const isUnsupportedTag = (name: string) => UNSUPPORTED.has(normalize(name));

export const bool = (value: boolean) => (value ? '1' : '0');
// The one truthiness, for #when, #if, the logic tags and block triggers. Risu's and/or/not take only `1`.
export const truthy = (value: string) => value === '1' || value === 'true';

export const readVar = (context: CbsContext, name: string) => context.variables.get(name) ?? UNSET;
export const readToggle = (context: CbsContext, key: string) => context.toggle(key) ?? UNSET;
// risu-alpha keeps no global variables: a toggle reads as `toggle_<key>`, and every other name is unset.
export const TOGGLE_GLOBAL = 'toggle_';
const readGlobal = (context: CbsContext, name: string) => (name.startsWith(TOGGLE_GLOBAL) ? readToggle(context, name.slice(TOGGLE_GLOBAL.length)) : UNSET);

const messageIndex = (context: CbsContext) => ('message' in context.source ? context.source.message : null);
// A bot reads the greeting as message -1 and the first message after it as 0, so a message's number is its index
// less this.
const opened = (context: CbsContext) => (context.greeting === null ? 0 : 1);
// Risu's chat.message, which never holds the greeting: Risu keeps it on the character.
const afterGreeting = (context: CbsContext) => context.messages.slice(opened(context));
const currentMessage = (context: CbsContext) => {
  const index = messageIndex(context);
  return index === null ? undefined : context.messages[index];
};

// Arrays and dicts go out as JSON with each `::` escaped, so a tag that takes one as an argument is not
// split inside it.
const serialize = (value: unknown) => JSON.stringify(value).replaceAll('::', '\\u003a\\u003a');
const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
export function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
// An array argument: a JSON array, or items separated by `§`. An unset variable is an empty array, where Risu's
// holds one item, `null`.
export function items(text: string): string[] {
  if (text === '') return [];
  const value = json(text);
  if (value === null) return [];
  return Array.isArray(value) ? value.map(asText) : text.split('§');
}
export function dict(text: string): Record<string, unknown> {
  const value = json(text);
  return isRecord(value) ? value : {};
}
const variadic = (args: string[]) => (args.length === 1 ? items(args[0]!) : args);
// A value that is no number counts as 0, as in Risu: an unset variable reads 'null'.
const numbers = (args: string[]) => variadic(args).map((value) => Number(value) || 0);

const cardText = (field: 'description' | 'personality' | 'scenario' | 'exampleDialogue'): Run => (_, { context, insert }) => (context.card ? insert(context.card[field]) : null);
define('char bot', 0, (_, { context: { card } }) => card && (card.nickname || card.name));
define('user', 0, (_, { context: { persona } }) => persona && persona.name);
define('persona userpersona', 0, (_, { context: { persona }, insert }) => persona && insert(persona.description));
define('description chardesc', 0, cardText('description'));
define('personality charpersona', 0, cardText('personality'));
define('scenario', 0, cardText('scenario'));
define('exampledialogue examplemessage', 0, cardText('exampleDialogue'));
const promptText = (field: 'main' | 'globalNote' | 'authorNote'): Run => (_, { context, insert }) => (context.prompt ? insert(context.prompt[field]) : null);
define('mainprompt systemprompt', 0, promptText('main'));
define('globalnote systemnote ujb', 0, promptText('globalNote'));
define('authornote', 0, promptText('authorNote'));
// An entry in Risu's own lore fields, which bots read back from {{lorebook}} and Lua's getLoreBooks.
export const asRisuLore = (entry: Pick<LoreEntry, 'name' | 'keys' | 'secondaryKeys' | 'insertionOrder' | 'constant' | 'selective' | 'useRegex'>, content: string) => ({
  key: entry.keys.join(', '),
  secondkey: entry.secondaryKeys.join(', '),
  comment: entry.name,
  content,
  insertorder: entry.insertionOrder,
  alwaysActive: entry.constant,
  selective: entry.selective,
  useRegex: entry.useRegex,
  mode: 'normal',
});
// Each entry a JSON string, raw, as Risu lists them.
define('lorebook worldinfo', 0, (_, { context }) => serialize(context.lore.map((entry) => JSON.stringify(asRisuLore(entry, entry.content)))));

// Risu's markup, which the display dims until a bot's buttons can run (design §6.4).
define('button', 2, ([label, trigger]) => `<button class="button-default" risu-trigger="${trigger}">${label}</button>`);

// Resolve assets only for display; prompts keep tags literal. Missing assets draw nothing and enter context.unfound.
const assetTag = (render: (url: string, asset: BotAsset) => string): Run => ([name], { context, random }) => {
  if (context.stage !== 'display') return null;
  const asset = findAsset(context.assets, name!, random);
  if (!asset) context.unfound?.add(name!);
  return asset ? render(assetUrl(asset.id), asset) : '';
};
// Put src on video itself for resolveAssets/sanitization; Story.tsx keeps it muted until user playback.
const video = (url: string) => `<video src="${url}" controls autoplay loop></video>`;
const mutedVideo = (url: string) => `<video src="${url}" autoplay muted loop></video>`;
define('raw path', 1, assetTag((url) => url));
// Self-closed as Risu writes them: a bot's display regex for the model's own <img src="name"> must not catch these.
define('img', 1, assetTag((url) => `<img src="${url}"/>`));
define('image', 1, assetTag((url) => `<div class="risu-inlay-image"><img src="${url}"/></div>\n`));
// Risu tells a video by its file's extension; Hazelle by the type the file was kept as.
define('asset', 1, assetTag((url, { type }) => `${isVideo(type) ? mutedVideo(url) : `<img src="${url}"/>`}\n`));
define('video', 1, assetTag(video));
define('videoimg', 1, assetTag(mutedVideo));
define('source', 1, ([name], { context: { stage, faces } }) => {
  if (stage !== 'display') return null;
  const face = name!.toLowerCase();
  return (face === 'char' ? faces.char : face === 'user' ? faces.user : null) ?? '';
});
define('assetlist', 0, (_, { context: { card, assets } }) => (card ? serialize(assets.filter((asset) => asset.module === undefined).map(({ name }) => name)) : ''));
// The asset prompt it lists from is counted at import and not brought (convert.ts), so it lists nothing.
define('chardisplayasset', 0, (_, { context: { card } }) => (card ? '[]' : null));
define('moduleenabled', 1, ([namespace], { context }) => (context.modules.includes(namespace!) ? '1' : '0'));
define('moduleassetlist', 1, ([namespace], { context: { modules, assets } }) => (modules.includes(namespace!) ? serialize(assets.filter((asset) => asset.module === namespace).map(({ name }) => name)) : ''));

// Prompt strips inlay/textfile tags and pipeline sends attachments separately.
// Display preserves tags until post-regex placement (engine/assets).
define('inlay inlayed inlayeddata', 1, (_, { context }) => (context.stage === 'display' ? null : ''));
define('textfile', 1, (_, { context }) => (context.stage === 'display' ? null : ''));

define('getvar', 1, ([name], { context }) => readVar(context, name!));
define('setvar', 2, ([name, value], { context, writes }) => {
  if (writes) context.variables.set(name!, value!);
  return '';
});
// Counting from 0 when the value is not a number, where Risu's gives NaN.
define('addvar', 2, ([name, amount], { context, writes }) => {
  if (writes) context.variables.set(name!, String(asNumber(readVar(context, name!)) + Number(amount)));
  return '';
});
// Unset is a missing name, not the text `null`, which a bot may have set.
define('setdefaultvar', 2, ([name, value], { context, writes }) => {
  // A stored `null` is an unset variable too: what a Lua nil write leaves, and what Risu fills (cbs.ts:849).
  const current = context.variables.get(name!);
  if (writes && (!current || current === UNSET)) context.variables.set(name!, value!);
  return '';
});
define('getglobalvar', 1, ([name], { context }) => readGlobal(context, name!));
define('tempvar gettempvar', 1, ([name], { temp }) => temp.get(name!) ?? '');
define('settempvar', 2, ([name, value], { temp }) => {
  temp.set(name!, value!);
  return '';
});
define('return', 1, ([value]) => {
  throw new Return(value!);
});
define('call', 1, ([name, ...args], env) => env.call(name!, args));
define('arg', 1, ([index], env) => env.arg(Number(index)));
define('slot', 1, ([name], env) => env.slot(name!));

define('equal', 2, ([a, b]) => bool(a === b));
define('notequal', 2, ([a, b]) => bool(a !== b));
define('greater', 2, ([a, b]) => bool(Number(a) > Number(b)));
define('less', 2, ([a, b]) => bool(Number(a) < Number(b)));
define('greaterequal', 2, ([a, b]) => bool(Number(a) >= Number(b)));
define('lessequal', 2, ([a, b]) => bool(Number(a) <= Number(b)));
define('and', 2, ([a, b]) => bool(truthy(a!) && truthy(b!)));
define('or', 2, ([a, b]) => bool(truthy(a!) || truthy(b!)));
define('not', 1, ([a]) => bool(!truthy(a!)));
define('all', 1, (args) => bool(variadic(args).every(truthy)));
define('any', 1, (args) => bool(variadic(args).some(truthy)));
export const isErrorText = (text: string) => /^error:/i.test(text);
define('iserror', 1, ([text]) => bool(isErrorText(text!)));

// A value that is not a number counts as 0.
function asNumber(text: string): number {
  const value = Number(text);
  return Number.isNaN(value) ? 0 : value;
}
const variableNumber = (context: CbsContext) => (token: string) => asNumber(token.startsWith('$') ? readVar(context, token.slice(1)) : readGlobal(context, token.slice(1)));
define('calc', 1, ([expression], { context }) => {
  const value = calc(expression!, variableNumber(context));
  return value === null ? null : String(value);
});
define('round', 1, ([n]) => String(Math.round(Number(n))));
define('floor', 1, ([n]) => String(Math.floor(Number(n))));
define('ceil', 1, ([n]) => String(Math.ceil(Number(n))));
define('abs', 1, ([n]) => String(Math.abs(Number(n))));
define('remaind', 2, ([a, b]) => String(Number(a) % Number(b)));
define('pow', 2, ([a, b]) => String(Number(a) ** Number(b)));
define('fixnum fixnumber', 2, ([n, digits]) => Number(n).toFixed(Number(digits)));
define('min', 1, (args) => String(Math.min(...numbers(args))));
define('max', 1, (args) => String(Math.max(...numbers(args))));
define('sum', 1, (args) => String(numbers(args).reduce((total, n) => total + n, 0)));
define('average', 1, (args) => {
  const all = numbers(args);
  return String(all.reduce((total, n) => total + n, 0) / all.length);
});
define('tonumber', 1, ([text]) => text!.replace(/[^\d.-]/g, ''));
define('fromhex', 1, ([hex]) => String(parseInt(hex!, 16)));
define('tohex', 1, ([n]) => Number(n).toString(16));

// One argument is a JSON array, or a list split at each `,` or `:` (`\,` keeps a comma).
function options(text: string): string[] {
  const listed = json(text);
  return Array.isArray(listed) ? listed.map(asText) : text.split(/(?<!\\)[,:]/).map((option) => option.replaceAll('\\,', ','));
}
function choose(args: string[], next: () => number): string | null {
  if (args.length === 0) return String(next());
  const from = args.length > 1 ? args : options(args[0]!);
  return from[Math.floor(next() * from.length)] ?? null;
}
// Bound each tag's allocation/loop count, not the whole text; oversized arguments leave the tag literal.
const MOST = 10_000;
function roll(notation: string, next: () => number): string | null {
  const [, count, sides] = /^(?:(\d*)d)?(\d+)$/i.exec(notation.trim()) ?? [];
  const dice = count ? Number(count) : 1;
  const faces = Number(sides);
  if (!Number.isSafeInteger(faces) || faces < 1 || dice > MOST) return null;
  let total = 0;
  for (let i = 0; i < dice; i++) total += Math.floor(next() * faces) + 1;
  return String(total);
}
// pick and rollp keep Risu's seed, the character, chat and message count, and not the tag's place.
const pickRolls = (context: CbsContext) => seeded(context.pickSeed);
define('random', 0, (args, { random }) => choose(args, random));
define('pick', 0, (args, { context }) => choose(args, pickRolls(context)));
define('randint', 2, ([low, high], { random }) => {
  const [min, max] = [Math.ceil(Number(low)), Math.floor(Number(high))];
  return min <= max ? String(min + Math.floor(random() * (max - min + 1))) : null;
});
define('dice', 1, ([notation], { random }) => roll(notation!, random));
// With no argument, 1d6; Risu returns 1.
define('roll', 0, ([notation = '1d6'], { random }) => roll(notation, random));
define('rollp rollpick', 0, ([notation = '1d6'], { context }) => roll(notation, pickRolls(context)));
define('hash', 1, ([text]) => String(1_000_000 + Math.floor(seeded(text!)() * 9_000_000)));

// A timestamp argument is in seconds, as documented.
const formatAt = ([format, timestamp]: string[], { now, timeZone }: CbsContext['clock']) =>
  formatTime(format!, timestamp === undefined ? now : Number(timestamp) * 1000, timeZone);
define('time', 0, (args, { context: { clock } }) => (args.length ? formatAt(args, clock) : clockTime(clock.now, clock.timeZone)));
define('date datetimeformat', 0, (args, { context: { clock } }) => (args.length ? formatAt(args, clock) : calendarDate(clock.now, clock.timeZone)));
define('unixtime', 0, (_, { context }) => String(Math.floor(context.clock.now / 1000)));
define('isotime', 0, (_, { context }) => clockTime(context.clock.now, 'UTC'));
define('isodate', 0, (_, { context }) => calendarDate(context.clock.now, 'UTC'));
define('messagetime', 0, (_, { context }) => {
  const time = currentMessage(context)?.time ?? null;
  return time === null ? null : clockTime(time, context.clock.timeZone);
});
define('messagedate', 0, (_, { context }) => {
  const time = currentMessage(context)?.time ?? null;
  return time === null ? null : calendarDate(time, context.clock.timeZone);
});
define('idleduration', 0, (_, { context }) => {
  const time = context.messages.at(-1)?.time ?? null;
  return time === null ? null : duration(context.clock.now - time);
});
define('messageidleduration', 0, (_, { context }) => {
  const index = messageIndex(context);
  const before = index === null ? null : (context.messages[index - 1]?.time ?? null);
  const time = currentMessage(context)?.time ?? null;
  return before === null || time === null ? null : duration(time - before);
});
// Milliseconds as strings and "0" for an unknown time, as Risu gives them, unlike the seconds of {{unixtime}}.
define('messageunixtimearray', 0, (_, { context }) => serialize(afterGreeting(context).map(({ time }) => String(time ?? 0))));

// Chat tags read stored text, tags and all: risu-alpha never bakes a message.
const lastOf = (context: CbsContext, role: 'user' | 'assistant') => {
  const before = messageIndex(context) ?? context.messages.length;
  return context.messages[context.previous[role][before]!]?.text ?? '';
};
define('lastmessage', 0, (_, { context }) => context.messages.at(-1)?.text ?? '');
define('lastmessageid lastmessageindex', 0, (_, { context }) => (context.messages.length ? String(context.messages.length - 1 - opened(context)) : null));
define('previouscharchat lastcharmessage', 0, (_, { context }) => lastOf(context, 'assistant'));
define('previoususerchat lastusermessage', 0, (_, { context }) => lastOf(context, 'user'));
define('previouschatlog', 1, ([number], { context }) => context.messages[Number(number) + opened(context)]?.text ?? 'Out of range');
// Keep Risu history keys role/data/time: bot Lua reads role to distinguish user messages.
const luaRole = (role: HistoryMessage['role']) => (role === 'user' ? 'user' : 'char');
const messageObject = ({ role, text, time }: HistoryMessage) => JSON.stringify({ role: luaRole(role), data: text, ...(time !== null && { time }) });
// Without an argument the greeting leads, as in Risu; with any the texts after it, `role` among them prefixing each
// with its role.
define('history messages', 0, (args, { context }) =>
  serialize(
    args.length === 0
      ? context.messages.map(messageObject)
      : afterGreeting(context).map(({ role, text }) => (args.includes('role') ? `${luaRole(role)}: ${text}` : text)),
  ),
);
define('userhistory usermessages', 0, (_, { context }) => serialize(afterGreeting(context).filter(({ role }) => role === 'user').map(messageObject)));
define('charhistory charmessages', 0, (_, { context }) => serialize(afterGreeting(context).filter(({ role }) => role === 'assistant').map(messageObject)));
// Outside a message (the background HTML, a prompt) Risu reads -1, the greeting's number too.
define('chatindex', 0, (_, { context }) => {
  const index = messageIndex(context);
  return String(index === null ? -1 : index - opened(context));
});
// Risu's fmIndex: the card's first message -1 and its first alternate greeting 0, one less than card.greetings counts.
define('firstmsgindex firstmessageindex', 0, (_, { context: { greeting } }) => (greeting && greeting.index !== null ? String(greeting.index - 1) : null));
// Bots expect Risu's char role. Outside a message use unset: CBS context has no prompt-block role.
define('role', 0, (_, { context }) => {
  const role = currentMessage(context)?.role;
  return role === undefined ? UNSET : role === 'user' ? 'user' : 'char';
});
define('isfirstmsg isfirstmessage', 0, (_, { context }) => bool(context.greeting !== null && messageIndex(context) === 0));

define('replace', 3, ([text, find, replacement]) => text!.replaceAll(find!, replacement!));
define('split', 2, ([text, separator]) => serialize(text!.split(separator!)));
define('join', 2, ([array, separator]) => items(array!).join(separator));
define('spread', 1, ([array]) => items(array!).join('::'));
define('trim', 1, ([text]) => text!.trim());
define('length', 1, ([text]) => String([...text!].length));
define('lower', 1, ([text]) => text!.toLowerCase());
define('upper', 1, ([text]) => text!.toUpperCase());
define('capitalize', 1, ([text]) => text!.charAt(0).toUpperCase() + text!.slice(1));
define('startswith', 2, ([text, prefix]) => bool(text!.startsWith(prefix!)));
define('endswith', 2, ([text, suffix]) => bool(text!.endsWith(suffix!)));
define('contains', 2, ([text, part]) => bool(text!.includes(part!)));
define('reverse', 1, ([text]) => [...text!].reverse().join(''));
define('unicodeencode', 1, ([text, index = '0']) => {
  const code = text!.codePointAt(Number(index));
  return code === undefined ? null : String(code);
});
define('unicodedecode', 1, ([code]) => String.fromCodePoint(Number(code)));
// ue decodes too, as Risu's own description of it says. Text that is not hex, or none, is U+0000; Risu keeps a code's
// low 16 bits.
define('u unicodedecodefromhex ue unicodeencodefromhex', 0, ([hex = '']) => String.fromCodePoint(parseInt(hex, 16) || 0));

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
// Leniently, as Risu: what is outside the alphabet is skipped, and a lone last character dropped.
function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  return Uint8Array.from(atob(clean.length % 4 === 1 ? clean.slice(0, -1) : clean), (char) => char.charCodeAt(0));
}
const flip = (byte: number) => byte ^ 0xff;
define('xor xorencrypt xorencode xore', 0, ([text = '']) => toBase64(utf8.encode(text).map(flip)));
define('xordecrypt xordecode xord', 1, ([text]) => fromUtf8.decode(fromBase64(text!).map(flip)));
// The default shift, 32768, is its own inverse. Each UTF-16 unit shifts alone, as in Risu, so text outside the BMP comes
// back whole only after the round trip.
define('crypt crypto caesar encrypt decrypt', 1, ([text, shift]) => {
  const by = shift?.trim() ? Math.trunc(Number(shift)) : NaN;
  const step = Number.isFinite(by) ? by : 0x8000;
  let out = '';
  for (let at = 0; at < text!.length; at++) out += String.fromCharCode(text!.charCodeAt(at) + step);
  return out;
});

define('makearray array a', 0, (args) => serialize(args));
define('makedict dict object o d makeobject', 0, (args) =>
  serialize(Object.fromEntries(args.flatMap((pair) => (pair.includes('=') ? [[pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]] : [])))),
);
define('arraylength', 1, ([array]) => String(items(array!).length));
define('arrayelement', 2, ([array, index]) => items(array!).at(Number(index)) ?? UNSET);
define('dictelement objectelement', 2, ([object, key]) => {
  const value = dict(object!)[key!];
  return value === undefined ? UNSET : asText(value);
});
define('element ele', 1, ([root, ...path]) => {
  let value = json(root!);
  for (const key of path) value = Array.isArray(value) ? value[Number(key)] : isRecord(value) ? value[key] : undefined;
  // A step that finds 0, false or empty text gives it; Risu's gives `null` for those too.
  return value === undefined ? UNSET : asText(value);
});
// These return the changed array or dict, not the item removed as JS's shift and pop do, so a setvar can keep it.
define('objectassert dictassert', 3, ([object, key, value]) => {
  const current = dict(object!);
  return serialize(Object.hasOwn(current, key!) ? current : { ...current, [key!]: value });
});
define('arrayassert', 3, ([array, index, value]) => {
  const current = items(array!);
  const at = Number(index);
  if (!Number.isSafeInteger(at) || at < 0 || at >= MOST) return null;
  return serialize(Array.from({ length: Math.max(current.length, at + 1) }, (_, n) => current[n] ?? (n === at ? value : '')));
});
define('arrayshift', 1, ([array]) => serialize(items(array!).slice(1)));
define('arraypop', 1, ([array]) => serialize(items(array!).slice(0, -1)));
define('arraypush', 2, ([array, ...values]) => serialize([...items(array!), ...values]));
define('arraysplice', 3, ([array, start, count, ...insert]) => {
  const current = items(array!);
  current.splice(Number(start), Number(count), ...insert);
  return serialize(current);
});

// Preserve Risu's text-number array shape. Negative steps count down (Risu may hang); zero steps hit MOST.
define('range', 1, ([bounds]) => {
  const numbers = items(bounds!).map(Number);
  const [start = NaN, end = NaN, step = 1] = numbers.length === 1 ? [0, numbers[0]] : numbers;
  const count = Math.ceil((end - start) / step);
  if (count > MOST) return null;
  return serialize(count > 0 ? Array.from({ length: count }, (_, n) => String(start + n * step)) : []);
});
// Items compare as their text, as every array tag reads them, so 1 and "1" are one item; Risu's keeps both.
define('filter', 1, ([array, mode]) => {
  const all = items(array!);
  const kept = mode === 'unique' ? all : all.filter((item) => item !== '');
  return serialize(mode === 'nonempty' ? kept : [...new Set(kept)]);
});

define('br newline', 0, () => '\n');
define('blank none', 0, () => '');
// Ruled 2026-10-10: Risu draws its own logo here; Hazelle draws nothing.
define('risu', 0, () => '');
// A backslash and an n, not a line break; with a count, that many.
define('cbr cnl cnewline', 0, ([count = '1']) => (Number(count) > MOST ? null : '\\n'.repeat(Number(count))));
define('bo ddecbo doubledisplayescapedcurlybracketopen', 0, () => escapeCbs('{{'));
define('bc ddecbc doubledisplayescapedcurlybracketclose', 0, () => escapeCbs('}}'));
define('decbo displayescapedcurlybracketopen', 0, () => escapeCbs('{'));
define('decbc displayescapedcurlybracketclose', 0, () => escapeCbs('}'));
const ESCAPE_NAMES: Record<string, string> = {
  '(': 'displayescapedbracketopen debo',
  ')': 'displayescapedbracketclose debc',
  '<': 'displayescapedanglebracketopen deabo',
  '>': 'displayescapedanglebracketclose deabc',
  ':': 'displayescapedcolon dec',
  ';': 'displayescapedsemicolon',
};
for (const [char, names] of Object.entries(ESCAPE_NAMES)) define(`${char} ${names}`, 0, () => escapeCbs(char));
define('comment', 1, ([text], { context }) => (context.stage === 'display' ? text! : ''));
// The lorebook track scans the entry's raw text, so the key still chains entries.
define('hiddenkey', 1, () => '');
// The text up to its last character among stops, scanning back from the end only, since the text may be long.
function upToLast(text: string, stops: string): string {
  let at = text.length;
  while (at > 0 && !stops.includes(text[at - 1]!)) at--;
  return text.slice(0, at);
}
define('bkspc', 0, () => (before) => upToLast(before.trimEnd(), ' \t\n').trimEnd());
// Text that already ends a sentence loses that sentence; Risu's removes nothing.
define('erase', 0, () => (before) => {
  const text = before.trimEnd();
  let end = text.length;
  while (end > 0 && '.!?'.includes(text[end - 1]!)) end--;
  return upToLast(text.slice(0, end), '.!?\n').trimEnd();
});
// A missing reading is empty; Risu's shows `undefined`.
define('ruby furigana', 1, ([text, reading = '']) => `<ruby>${text}<rp> (</rp><rt>${reading}</rt><rp>) </rp></ruby>`);
const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' };
// Last argument is code; preceding language names its fence (app/ui/story/highlight.ts).
// Unlike Risu, escape & too.
const escapeHtml = (text: string) => text.replace(/[&"'<>]/g, (char) => HTML_ENTITIES[char]!);
define('codeblock', 1, (args) => {
  const language = args.length > 1 ? /^[\w+#-]+$/.exec(args[0]!.trim())?.[0] : undefined;
  return `<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(args.at(-1)!)}</code></pre>`;
});
// Only the first argument, as in Risu: a formula holding :: is cut there.
define('tex latex katex', 1, ([formula]) => `$$${formula}$$`);
// Risu's attached text file. On screen Risu draws a box with its name, which is not built: there it stays as written.
define('file', 2, ([, data], { context }) => (context.stage === 'display' ? null : fromUtf8.decode(fromBase64(data!))));

define('language', 0, (_, { context: { language } }) => language);
define('model', 0, (_, { context: { model } }) => model && model.id);
define('axmodel', 0, (_, { context: { axModel } }) => axModel);
const maxContext = (model: CbsContext['model']) => (model && model.maxContext !== null ? String(model.maxContext) : null);
define('maxcontext', 0, (_, { context: { model } }) => maxContext(model));
define('prefillsupported prefill', 0, (_, { context: { model } }) => (model && model.prefill !== null ? bool(model.prefill) : null));
define('screenwidth', 0, (_, { context }) => (context.screen ? String(context.screen.width) : null));
define('screenheight', 0, (_, { context }) => (context.screen ? String(context.screen.height) : null));
// Risu's keys about its own app, which no answer here fits, so they stay as written: its platform, version, UI language
// (not {{language}}'s translation target) and model enums.
const RISU_METADATA = new Set(['mobile', 'local', 'node', 'risutype', 'version', 'majorversion', 'majorver', 'major', 'language', 'locale', 'lang', 'browserlanguage', 'browserlocale', 'browserlang', 'modelshortname', 'modelformat', 'modelprovider', 'modeltokenizer']);
// The key is lowercased only, as in Risu.
define('metadata', 1, ([key], { context: { model } }) => {
  const name = key!.toLowerCase();
  if (name === 'maxcontext') return maxContext(model);
  if (name === 'modelname' || name === 'modelinternalid') return model && model.id;
  if (name === 'imateapot') return '🫖';
  return RISU_METADATA.has(name) ? null : `Error: ${name} is not a valid metadata key.`;
});
define('triggerid', 0, (_, { context }) => context.triggerId || UNSET);
