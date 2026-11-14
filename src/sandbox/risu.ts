import { toBase64 } from '../base64';
import { RISU_ABSENT, RISU_DECLINED, RISU_REPLACERS } from '../tool-api/risu-methods';
import { risuRegex } from '../tool-api/risu-regex';
import { readRisuLoreBase, risuLoreBase } from '../tool-api/risu-lore';

// Risu v3 shapes stay in this adapter over `api`, never in tool-api/protocol.ts (research/risu-plugin-adapter-plan.md §3).
// Unmapped calls throw; declined methods read as undefined for typeof guards. Both report to 점검.

type Callback = () => unknown;
type MessageAction = (message: { chatId: string; index: number }) => unknown;
type Replacer = (content: never, type: string) => unknown;
type Handler = (content: string) => unknown;
type Listener = (arg: { char: unknown; chat: unknown; characterIndex: number; chatIndex: number; messageIndex: number }) => unknown;
type Scope = Record<string, unknown>;

// Hash chat ids for stable plugin keys, but use real character-list indices:
// plugins assign characters[index], where hashes would create huge sparse arrays (Asset Maid, 2026-10).
const chatNumber = (id: string) => {
  let hash = 2166136261;
  for (let at = 0; at < id.length; at++) hash = Math.imul(hash ^ id.charCodeAt(at), 16777619);
  return hash >>> 1;
};

const loreEntry = (entry: Hazelle.LoreEntry) => ({ ...risuLoreBase({ name: entry.name, keys: entry.keys, content: entry.text, constant: entry.always }, ', '), disabled: !entry.on });

const character = (card: Hazelle.Card, lorebook: Hazelle.LoreEntry[]) => ({
  chaId: card.id, type: 'character', name: card.name, desc: card.description, personality: card.personality, scenario: card.scenario,
  firstMessage: card.greeting ?? '', creatorNotes: card.creatorNotes, tags: card.tags,
  globalLore: lorebook.filter(({ owner }) => owner.kind === 'character').map(loreEntry),
});

// The keys of character a write takes, by the Card field each lands in; another that changed is told to 점검.
const CARD_FIELDS = { name: 'name', desc: 'description', personality: 'personality', scenario: 'scenario', firstMessage: 'greeting', creatorNotes: 'creatorNotes', tags: 'tags' } as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// localLore: the chat's own lorebook. scriptstate: its variables, under Risu's $ names.
const chatOf = (id: string, messages: Hazelle.Message[], lorebook: Hazelle.LoreEntry[], variables: [string, string][]) => ({
  id, message: messages.map((message) => ({ role: message.role, data: message.raw, time: message.time, chatId: message.id })),
  localLore: lorebook.filter(({ owner }) => owner.kind === 'chat').map(loreEntry),
  scriptstate: Object.fromEntries(variables.map(([name, value]) => [`$${name}`, value])),
});
type RisuChat = ReturnType<typeof chatOf>;
// Risu's lore has no enabled flag; loreEntry's disabled is the only one a plugin meets.
function fromLore(entry: Record<string, unknown>): Omit<Hazelle.LoreEntry, 'owner'> {
  const { name, keys, content, constant } = readRisuLoreBase(entry, (value) => String(value ?? ''));
  return { name, keys, text: content, always: constant, on: entry.disabled !== true };
}
const sameLore = (a: Omit<Hazelle.LoreEntry, 'owner'>, b: Omit<Hazelle.LoreEntry, 'owner'>) =>
  a.text === b.text && a.always === b.always && a.on === b.on && a.keys.join('\n') === b.keys.join('\n');
// The keys of a chat a write takes.
const CHAT_KEYS = new Set(['id', 'message', 'localLore', 'scriptstate']);
// Risu's other fields of a chat (upstream Chat, read 2026-11-14), which Hazelle does not take: each told to 점검 when
// written. A key that is neither is the plugin's own, kept with the chat and its branches as Risu keeps it (CHAT_OWN).
const CHAT_UNTAKEN = new Set([
  'note', 'name', 'sdData', 'supaMemoryData', 'hypaV2Data', 'lastMemory', 'suggestMessages', 'isStreaming', 'activeStreamingDisplayOptimizationMode', 'modules',
  'bindedPersona', 'fmIndex', 'hypaV3Data', 'folderId', 'lastDate', 'bookmarks', 'bookmarkNames', 'useLocallySetGlobalVariables', 'GLGlobalVariables', 'onboardingDone',
]);
const CHAT_OWN = 'risu:chat';

const MODEL_ROLES = new Set(['system', 'user', 'assistant']);
// A Response with one of these statuses throws when given a body.
const NULL_BODY = new Set([204, 205, 304]);

// Risu's script handler modes on Hazelle's stages, each after the bot's Lua as Risu runs them (processScriptFull):
// display per message shown, output on the reply, input on the message sent, process on each chat message of the request.
const STAGES = { display: 'showing', output: 'replying', input: 'sending', process: 'requesting' } as const;
type Mode = keyof typeof STAGES;

// setup: null with no chat open, which leaves out the keys built from it; the selected persona is then the account's.
type Reads = { account(): Promise<Hazelle.Account>; setup(): Promise<Hazelle.Setup | null>; lorebook(): Promise<Hazelle.LoreEntry[]> };
const persona = async (read: Reads) => {
  const { personas } = await read.account();
  const setup = await read.setup();
  const id = setup ? setup.persona : personas.find(({ current }) => current)?.id;
  return personas.find((each) => each.id === id);
};
// The keys of Risu's database getDatabase builds; any other is told to 점검 and left out, so a plugin's guard on it holds.
const DATABASE: Record<string, (read: Reads) => Promise<unknown>> = {
  username: async (read) => (await persona(read))?.name,
  personaPrompt: async (read) => (await persona(read))?.description,
  personas: async (read) => (await read.account()).personas.map(({ id, name, description, picture }) => ({ id, name, personaPrompt: description, icon: picture ?? '' })),
  selectedPersona: async (read) => {
    const selected = await persona(read);
    return selected && (await read.account()).personas.indexOf(selected);
  },
  characters: async (read) => (await read.account()).characters.map(({ id, name }) => ({ chaId: id, type: 'character', name })),
  maxContext: async (read) => (await read.setup())?.limits.context ?? undefined,
  maxResponse: async (read) => (await read.setup())?.limits.reply ?? undefined,
  modules: async (read) => {
    const setup = await read.setup();
    const lorebook = setup ? await read.lorebook() : [];
    return setup?.modules.map(({ id, name, regex }) => ({ id, name, lorebook: lorebook.filter(({ owner }) => owner.kind === 'module' && owner.id === id).map(loreEntry), regex: regex.map(risuRegex) }));
  },
  enabledModules: async (read) => (await read.setup())?.modules.map(({ id }) => id),
  // Every module on in the chat is in enabledModules, a conversation prompt's own included, which leaves Risu's list of
  // modules a preset turns on besides them empty.
  moduleIntergration: async (read) => ((await read.setup()) ? '' : undefined),
  // Risu's getDatabase never answers it (allowedDbKeys); a preset's regex is a module here, in modules.
  presetRegex: async () => undefined,
};
const once = <T>(read: () => Promise<T>) => {
  let held: Promise<T> | undefined;
  return () => held ??= read();
};

// Expose only rendered chat rows/bodies and bot sheets, including hidden rows; greeting index is -1.
// Round-trip CSS.escape for digit-leading ids in selectors.
const ROW = String.raw`(?:\.risu-chat)?(?:\[data-chat-index\])?\[data-chat-(id|index)="((?:[^"\\]|\\.)+)"\]`;
const BODY = new RegExp(`^(?:\\.default-chat-screen\\s+)?${ROW}\\s+\\.chattext(?::not\\(\\.hidden\\))?$`);
const ONE_ROW = new RegExp(`^(?:\\.default-chat-screen\\s+)?${ROW}$`);
const ROWS = /^(?:\.default-chat-screen\s+)?(?:\.risu-chat)?\[data-chat-index\]$/;
const SCREEN = '.default-chat-screen';
const STYLES = /^style$/;
const LINKS = /^link\[rel~?="?stylesheet"?\]$/;
const SHEETS = /^style\s*,\s*link\[rel~?="?stylesheet"?\]$/;
// Risu's SafeClassArray (Risuai.d.ts): at and length answer asynchronously, and unwarpSafeArray hands out the items.
const ITEMS = Symbol('items');
const safeArray = <T>(items: T[]) => ({ [ITEMS]: items, at: async (index: number) => items.at(index), length: async () => items.length, push: async (item: T) => { items.push(item); } });
type Row = { index: number; id: string; drawn: Hazelle.Rendered };
const escapeAttribute = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const bodyHtml = ({ html }: Hazelle.Rendered) => `<div class="chattext">${html}</div>`;
const rowHtml = ({ index, id, drawn }: Row) => `<div class="risu-chat" data-chat-index="${index}" data-chat-id="${escapeAttribute(id)}">${bodyHtml(drawn)}</div>`;
const bodyOf = (drawn: Hazelle.Rendered) => ({ getOuterHTML: async () => bodyHtml(drawn), getInnerHTML: async () => drawn.html, innerText: async () => drawn.text });
const rowOf = (row: Row) => ({
  getOuterHTML: async () => rowHtml(row),
  getInnerHTML: async () => bodyHtml(row.drawn),
  innerText: async () => row.drawn.text,
  getAttribute: async (name: string) => (name === 'data-chat-index' ? String(row.index) : name === 'data-chat-id' ? row.id : null),
  // Every message is answered whether the screen shows it or not, so there is nothing to bring into view; a plugin that
  // scrolls Risu's chat to load older rows (Novelistic) finds them all already there.
  scrollIntoView: async () => {},
});
const unescapeCss = (text: string) => text.replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex?: string, char?: string) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : char!));

const API_VERSION = '3.0';

// Run as an async function body for top-level await and private declarations (Risu apiV3/factory.ts).
// Keep the trailing newline so a closing line comment cannot swallow the brace.
export const risuScript = (code: string) => `(async () => {${code}\n})()`;

// Installs Risuai, risuai and the dialog shims into scope; answers the frame's stop, which runs onUnload callbacks.
export function installRisu(api: Hazelle.Api, scope: Scope): () => void {
  const frame = api.frame!;
  const told = new Set<string>();
  const tell = (name: string) => { if (told.has(name)) return; told.add(name); frame.missing(name); };
  const refuse = (name: string): never => {
    tell(name);
    throw new Error(`Risu API '${name}' is not available in Hazelle${RISU_ABSENT.has(name) ? `: ${RISU_ABSENT.get(name)}` : ''}`);
  };
  // Risu's character holds every chat of it. Hazelle offers a plugin no chat list, and a partial one in the database's
  // characters would let a plugin that prunes by it (RisuPot's orphan cleanup) delete what it does not see. So there
  // chats reads undefined, told to 점검 when read, and is not enumerable, so no copy handed back carries it; only the
  // open chat's character holds a chat, that one (characterOf).
  const chatless = <T extends object>(value: T) => Object.defineProperty(value, 'chats', { get: () => { tell('character.chats'); return undefined; } });
  // The chat of a turn stage while its handlers run, by chat id since one frame serves every chat: Risu's calls then
  // read the turn, with what the bot's scripts wrote in it, and what they write lands with it. A chat's stages run one
  // at a time (the story lock), so one never nests in another. showing is never one: nothing it does is saved.
  const staged = new Map<string, Hazelle.Chat>();
  const during = async <T>(chat: Hazelle.Chat, run: () => Promise<T>) => {
    staged.set(chat.id, chat);
    try { return await run(); } finally { staged.delete(chat.id); }
  };
  // saved: the frame's own chat, where the story is written at once as Risu writes it; a turn's chat refuses it.
  const both = async () => {
    const saved = await frame.chat();
    return saved && { saved, chat: staged.get(saved.id) ?? saved };
  };
  const current = async () => (await both())?.chat ?? null;
  const buttons = new Map<string, { label: string; run: Callback }>();
  const messageActions = new Map<string, { label: string; run: MessageAction }>();
  // Where each chatId handed out was, as read: a picture often lands after the user moved to another chat, whose messages
  // the frame's chat then reads instead.
  const places = new Map<string, { chat: Hazelle.Chat; at: Hazelle.At }>();
  const place = (chat: Hazelle.Chat, { index, id, version }: Hazelle.At) => places.set(id, { chat, at: { index, id, version } });
  // What each scriptstate handed out held, by name, and each chat and its message list, by message id: a write is
  // compared with what the plugin read, so a variable the bot's scripts changed since is not written back, and only a
  // message the plugin was handed can be one it removed.
  const handed = new WeakMap<object, Map<string, string>>();
  const read = async (chat: Hazelle.Chat, lorebook?: Hazelle.LoreEntry[]) => {
    const messages = await chat.messages();
    for (const message of messages) place(chat, message);
    const risu = { ...await chat.data.get<Record<string, Hazelle.Json>>(CHAT_OWN), ...chatOf(chat.id, messages, lorebook ?? await chat.lorebook(), await chat.variables.entries()) };
    handed.set(risu.scriptstate, new Map(Object.entries(risu.scriptstate)));
    const texts = new Map(messages.map(({ id, raw }) => [id, raw]));
    for (const holder of [risu, risu.message]) handed.set(holder, texts);
    return risu;
  };
  // Merge Risu button places into one deduplicated menu; splitting would strand side-menu-only actions.
  const listedButtons = () => {
    const labels = new Set<string>();
    return [...buttons].flatMap(([id, { label }]) => labels.has(label) ? [] : (labels.add(label), [{ id, label }]));
  };
  const listedActions = () => [...messageActions].map(([id, { label }]) => ({ id, label }));
  const settings = new Map<string, Callback>();
  const replacers = { beforeRequest: new Set<Replacer>(), afterRequest: new Set<Replacer>() };
  const handlers: Record<Mode, Set<Handler>> = { display: new Set(), output: new Set(), input: new Set(), process: new Set() };
  const listeners = new Set<Listener>();
  const unloads: Callback[] = [];
  // The bot's sheet of the last message getRootDocument found, which is the whole chat's.
  let sheet: string | null = null;
  const kept = (row: Row) => { sheet = row.drawn.css; return row; };
  // The open chat's messages as Risu's rows, the greeting first; null with no chat open.
  const rows = async (): Promise<Row[] | null> => {
    const chat = await current();
    if (!chat) return null;
    const messages = await chat.messages();
    const [greeting, ...drawn] = await Promise.all([chat.rendered(null), ...messages.map(({ index, id, version }) => chat.rendered({ index, id, version }))]);
    const all = [...(greeting ? [{ index: -1, id: '', drawn: greeting }] : []), ...messages.flatMap(({ index, id }, at) => (drawn[at] ? [{ index, id, drawn: drawn[at] }] : []))];
    all.forEach(kept);
    return all;
  };
  const rowAt = async (by: 'id' | 'index', key: string): Promise<Row | null> => {
    const chat = await current();
    if (!chat) return null;
    if (by === 'index' && key === '-1') {
      const greeting = await chat.rendered(null);
      return greeting && kept({ index: -1, id: '', drawn: greeting });
    }
    const messages = await chat.messages();
    const message = by === 'id' ? messages.find(({ id }) => id === key) : messages[Number(key)];
    const drawn = message && await chat.rendered({ index: message.index, id: message.id, version: message.version });
    return drawn ? kept({ index: message.index, id: message.id, drawn }) : null;
  };
  // A member of Risu's SafeDocument or SafeElement that these answers lack reaches into the app's page: it reads
  // undefined, as a declined method does, told to 점검, so a plugin that stops there is not silent.
  const paged = <T extends object>(found: T): T => new Proxy(found, {
    get: (target, name, receiver) => {
      if (typeof name === 'string' && name !== 'then' && !(name in target)) tell('getRootDocument:page');
      return Reflect.get(target, name, receiver) as unknown;
    },
  });
  // Risu does not await a button or setting; holding the tool's lane for a whole screen would stall its other events.
  const press = (run: Callback | undefined) => { if (run) void Promise.resolve().then(run).catch((error: unknown) => console.error(error)); };

  const characterAt = async (id: string) => (await api.account()).characters.findIndex((each) => each.id === id);
  const opened = async () => {
    const open = await both();
    const card = open && await open.chat.card();
    return open && { ...open, card, characterIndex: card ? await characterAt(card.id) : -1, chatIndex: chatNumber(open.chat.id) };
  };
  type Opened = NonNullable<Awaited<ReturnType<typeof opened>>>;
  // Risu's character of a chat. chats holds that chat alone, which chatPage answers and takes too: it is
  // getCurrentChatIndex's number as in Risu, a hash far past the list's end, and a list that long would hang a plugin
  // that walks it. The character's other chats are not offered (design §6.10).
  const characterOf = async (chat: Hazelle.Chat, card: Hazelle.Card) => {
    const lorebook = await chat.lorebook();
    const chats = [await read(chat, lorebook)];
    const chatPage = chatNumber(chat.id);
    Object.setPrototypeOf(chats, Object.create(Array.prototype, { [chatPage]: { get: () => chats[0], set: (next: RisuChat) => { chats[0] = next; } } }) as object);
    return { ...character(card, lorebook), chatPage, chats };
  };
  const at = async (characterIndex: number, chatIndex: number) => {
    const open = await opened();
    return open && open.characterIndex === characterIndex && open.chatIndex === chatIndex ? open : null;
  };
  // A Risu chat written back onto the open one. Omitted localLore entries stay (the native upsert replaces by name),
  // told to 점검. A variable left out of the scriptstate handed out is unset; left out of another object, a copy or
  // one the plugin made, it may be one the bot's scripts wrote since, so it stays, told.
  const writeChat = async (name: string, path: string, { chat, saved }: Opened, value: { message: { role: string; data: string; chatId?: string }[]; localLore?: Record<string, unknown>[]; scriptstate?: Record<string, unknown> }) => {
    const messages = await saved.messages();
    // A message is removed only when the plugin was handed it and left its chatId out, those it kept leading the list in
    // their order: one that landed since it read the chat is none of its to remove, and a list with no such record, a
    // copy or one the plugin made, is read in place, where a shorter one is refused.
    const texts = handed.get(value) ?? handed.get(value.message);
    const ids = new Set(value.message.map(({ chatId }) => chatId));
    const gone = new Set([...texts?.keys() ?? []].filter((id) => !ids.has(id)));
    const kept = [...texts?.keys() ?? []].filter((id) => ids.has(id));
    if (gone.size ? !kept.every((id, at) => value.message[at]!.chatId === id) : !texts && value.message.length < messages.length) throw new Error(`Risu API '${name}' cannot remove messages it cannot tell apart in Hazelle`);
    // The plugin's own keys: those of the chat it was handed are all it holds; another object's join what is held.
    const own: Record<string, Hazelle.Json> = {};
    for (const [key, held] of Object.entries(value)) {
      if (CHAT_KEYS.has(key)) continue;
      const json = CHAT_UNTAKEN.has(key) || held === undefined ? undefined : JSON.stringify(held);
      if (json === undefined) tell(`${name}:${path}${key}`);
      else own[key] = JSON.parse(json) as Hazelle.Json;
    }
    const stored = await chat.data.get<Record<string, Hazelle.Json>>(CHAT_OWN) ?? {};
    const next = handed.has(value) ? own : { ...stored, ...own };
    if (JSON.stringify(next) !== JSON.stringify(stored)) chat.data.set(CHAT_OWN, next);
    for (const id of gone) texts!.delete(id);
    for (const message of messages) if (gone.has(message.id)) saved.remove(message.index);
    const places = messages.filter(({ id }) => !gone.has(id));
    value.message.forEach((message, at) => {
      const held = places[at];
      if (!held) saved.add(message.role === 'user' ? 'user' : 'char', message.data);
      else if (message.data !== held.raw) saved.edit(held.index, message.data);
    });
    if (value.scriptstate) {
      const read = handed.get(value.scriptstate);
      const before = read ?? new Map((await chat.variables.entries()).map(([key, held]) => [`$${key}`, held]));
      for (const [key, held] of Object.entries(value.scriptstate)) {
        if (!key.startsWith('$') || held === undefined) { tell(`${name}:${path}scriptstate.${key}`); continue; }
        const text = typeof held === 'string' ? held : JSON.stringify(held);
        if (text === before.get(key)) continue;
        chat.variables.set(key.slice(1), text);
        before.set(key, text);
      }
      const gone = [...before.keys()].filter((key) => !Object.hasOwn(value.scriptstate!, key));
      if (!read && gone.length) tell(`${name}:${path}scriptstate.remove`);
      for (const key of read ? gone : []) {
        chat.variables.delete(key.slice(1));
        read!.delete(key);
      }
    }
    if (!value.localLore) return;
    const lore = new Map((await chat.lorebook()).filter(({ owner }) => owner.kind === 'chat').map((entry) => [entry.name, entry]));
    const written = value.localLore.map(fromLore);
    const names = new Set(written.map(({ name }) => name));
    if ([...lore.keys()].some((name) => !names.has(name))) tell(`${name}:${path}localLore.remove`);
    for (const entry of written) {
      const held = lore.get(entry.name);
      if (!held || !sameLore(held, entry)) chat.writeLore(entry);
    }
  };
  const storage = (prefix: string) => {
    const keys = async () => (await api.storage.keys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    return {
      getItem: async (key: string) => (await api.storage.get(prefix + key)) ?? null,
      // Risu keeps whatever object it is handed, undefined fields included (selection-hero's drafts); the native store
      // takes JSON, so they drop out as a save would drop them.
      setItem: (key: string, value: unknown) => api.storage.set(prefix + key, JSON.parse(JSON.stringify(value)) as Hazelle.Json),
      removeItem: (key: string) => api.storage.delete(prefix + key),
      keys,
      clear: async () => { for (const key of await keys()) await api.storage.delete(prefix + key); },
      key: async (at: number) => (await keys())[at] ?? null,
      length: async () => (await keys()).length,
    };
  };
  // nativeFetch over the tool's fetch, which the relay carries: a refusal rejects as a failed fetch does, and the answer
  // is a Response made here, read whole before it is handed over.
  const fetchOf = async (url: string | URL, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw new TypeError(`Failed to fetch: Hazelle sends GET and POST only, not ${method}`);
    if (init.body != null && (method === 'GET' || typeof init.body !== 'string')) throw new TypeError('Failed to fetch: Hazelle sends a text body, with POST only');
    const chat = await current();
    if (!chat) throw new TypeError('Failed to fetch: no chat is open');
    const answer = await chat.fetch(String(url), { method, headers: Object.fromEntries(new Headers(init.headers)), ...(typeof init.body === 'string' && { body: init.body }), ...(init.signal && { signal: init.signal }) });
    if (!answer.ok) throw new TypeError(`Failed to fetch: ${answer.reason}${answer.code ? ` (${answer.code})` : ''}`);
    return new Response(NULL_BODY.has(answer.status) ? null : answer.body, { status: answer.status, headers: answer.headers });
  };
  // The three Risu stores are one synced tool storage here, each under its own prefix so their keys never meet.
  const local = storage('local:');
  const getArgument = async (key: string) => (await api.settings())[key];
  const setArgument = (key: string, value: string | number) => api.setSetting(key, value);
  // Risu's translation cache, from each text translated to its translation, over the open chat's translations only, where
  // Risu's spans every chat.
  const translated = async () => {
    const chat = await current();
    return chat ? (await chat.messages()).flatMap(({ text, raw, translation }) => (translation ? [translation.sent ? { key: translation.text, value: raw } : { key: text, value: translation.text }] : [])) : [];
  };
  // Risu's database as getDatabase builds it, of the keys asked that it builds.
  const database = async (keys: string[]) => {
    const chat = await current();
    const reads: Reads = { account: once(() => api.account()), setup: once(async () => chat && chat.setup()), lorebook: once(async () => chat ? chat.lorebook() : []) };
    const built: Record<string, unknown> = {};
    for (const key of keys.filter((each) => Object.hasOwn(DATABASE, each))) {
      const value = await DATABASE[key]!(reads);
      if (value !== undefined) built[key] = value;
    }
    return built;
  };
  const getCharacter = async () => { const open = await opened(); return open && open.card && characterOf(open.chat, open.card); };
  // Only the keys that changed from what getCharacter reads are written, as Risu's dbWrite asks before a write: under the
  // card's one answer, a refusal skipping it. Its chat is written as setChatToIndex writes one.
  const setCharacter = (name: string) => async (characterIndex: number | null, value: Record<string, unknown>) => {
    const open = await opened();
    if (!open?.card) throw new Error(`Risu API '${name}' found no character in the open chat`);
    if (characterIndex !== null && characterIndex !== open.characterIndex) throw new Error(`Risu API '${name}' reaches only the open chat's character in Hazelle`);
    const held: Record<string, unknown> = { ...character(open.card, await open.chat.lorebook()), chatPage: open.chatIndex };
    const { chats, ...fields } = value as { chats?: Parameters<typeof writeChat>[3][] };
    const edit: Record<string, unknown> = {};
    for (const [key, written] of Object.entries(fields)) {
      if (same(written, held[key])) continue;
      if (Object.hasOwn(CARD_FIELDS, key)) edit[CARD_FIELDS[key as keyof typeof CARD_FIELDS]] = written;
      else tell(`${name}:${key}`);
    }
    if (Object.keys(edit).length) {
      const answer = await open.chat.editCard(edit);
      if (!answer.ok && answer.reason !== 'not-allowed') throw new Error(`Risu API '${name}' failed in Hazelle: ${answer.reason}`);
    }
    if (chats?.[0]) await writeChat(name, 'chats.', open, chats[0]);
  };
  // Nothing of Risu's database is written here: one handed back as getDatabase read it is left as it is, and a key that
  // changed fails the write, each told to 점검.
  const setDatabase = (name: string) => async (value: Record<string, unknown>) => {
    const read = await database(Object.keys(value));
    const changed = Object.keys(value).filter((key) => !same(value[key], read[key]));
    for (const key of changed) tell(`${name}:${key}`);
    if (changed.length) throw new Error(`Risu API '${name}' cannot write ${changed.join(', ')} in Hazelle`);
  };
  const mapped: Scope = {
    apiVersion: API_VERSION,
    apiVersionCompatibleWith: [API_VERSION],
    getRuntimeInfo: async () => ({ apiVersion: API_VERSION, platform: 'hazelle', saveMethod: 'account' }),
    // Risu's repair of its character order, which here is the app's own and never out of step with the characters.
    checkCharOrder: async () => {},
    showContainer: async () => frame.show(),
    hideContainer: async () => frame.hide(),
    registerButton: async (arg: { name: string; id?: string }, callback: Callback) => {
      // As Risu throws: a button with no name (the label passed in the object's place) is one the app's menu refuses,
      // and every other button of the plugin with it.
      if (typeof arg?.name !== 'string' || !arg.name.trim()) throw new Error('name must be a non-empty string');
      const id = arg.id ?? crypto.randomUUID();
      buttons.set(id, { label: arg.name, run: callback });
      frame.menu(listedButtons());
      return { id };
    },
    registerSetting: async (_name: string, callback: Callback, _icon?: string, _iconType?: string, id = crypto.randomUUID()) => {
      settings.set(id, callback);
      return { id };
    },
    unregisterUIPart: async (id: string) => {
      settings.delete(id);
      if (buttons.delete(id)) frame.menu(listedButtons());
    },
    onUnload: async (callback: Callback) => { unloads.push(callback); },
    log: async (message: string) => console.log(message),
    pluginStorage: storage('plugin:'),
    getLocalPluginStorage: async () => local,
    safeLocalStorage: storage('safe:'),
    getArgument,
    getArg: getArgument,
    setArgument,
    setArg: setArgument,
    unwarpSafeArray: async (array: ReturnType<typeof safeArray>) => array[ITEMS],
    // Read-only, and only the chat screen and its messages: the rest of the page (body, to put a box of its own on the
    // app) is declined (design §6.10) and found nowhere.
    getRootDocument: async () => paged({
      querySelector: async (selector: string) => {
        const wanted = selector.trim();
        if (wanted === SCREEN) {
          const all = await rows();
          return all && paged({ getInnerHTML: async () => all.map(rowHtml).join(''), getOuterHTML: async () => `<div class="default-chat-screen">${all.map(rowHtml).join('')}</div>` });
        }
        if (ROWS.test(wanted)) {
          const first = (await rows())?.[0];
          return first ? paged(rowOf(first)) : null;
        }
        const body = BODY.exec(wanted);
        const one = body ?? ONE_ROW.exec(wanted);
        if (!one) { tell('getRootDocument:page'); return null; }
        const row = await rowAt(one[1] as 'id' | 'index', unescapeCss(one[2]!));
        return row && paged(body ? bodyOf(row.drawn) : rowOf(row));
      },
      querySelectorAll: async (selector: string) => {
        const wanted = selector.trim();
        if (ROWS.test(wanted)) return safeArray((await rows())?.map((row) => paged(rowOf(row))) ?? []);
        if (LINKS.test(wanted)) return safeArray([]);
        if (!STYLES.test(wanted) && !SHEETS.test(wanted)) { tell('getRootDocument:page'); return safeArray([]); }
        return safeArray(sheet === null ? [] : [paged({ getOuterHTML: async () => `<style>${sheet}</style>`, textContent: async () => sheet })]);
      },
    }),
    getDatabase: async (keys: string[] | 'all' = 'all') => {
      for (const key of keys === 'all' ? [] : keys) if (!Object.hasOwn(DATABASE, key)) tell(`getDatabase:${key}`);
      const built = await database(keys === 'all' ? Object.keys(DATABASE) : keys);
      (built.characters as object[] | undefined)?.forEach(chatless);
      return built;
    },
    setDatabase: setDatabase('setDatabase'),
    // Risu's Lite leaves the plugin list as it is, whatever it is handed.
    setDatabaseLite: async (value: Record<string, unknown>) => setDatabase('setDatabaseLite')(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'plugins'))),
    getCurrentLorebookEntries: async () => {
      const chat = await current();
      return chat ? (await chat.lorebook()).map(loreEntry) : [];
    },
    requestPluginPermission: async () => true,
    getCharacter,
    getChar: getCharacter,
    setCharacter: async (value: Record<string, unknown>) => setCharacter('setCharacter')(null, value),
    setChar: async (value: Record<string, unknown>) => setCharacter('setChar')(null, value),
    setCharacterToIndex: setCharacter('setCharacterToIndex'),
    getCharacterFromIndex: async (characterIndex: number) => {
      const open = await opened();
      return open && open.card && open.characterIndex === characterIndex ? characterOf(open.chat, open.card) : null;
    },
    getCurrentCharacterIndex: async () => (await opened())?.characterIndex ?? -1,
    getCurrentChatIndex: async () => (await opened())?.chatIndex ?? -1,
    getChatFromIndex: async (characterIndex: number, chatIndex: number) => {
      const open = await at(characterIndex, chatIndex);
      return open && read(open.chat);
    },
    setChatToIndex: async (characterIndex: number, chatIndex: number, value: Parameters<typeof writeChat>[3]) => {
      const open = await at(characterIndex, chatIndex);
      if (!open) throw new Error('Risu API \'setChatToIndex\' reaches only the open chat in Hazelle');
      await writeChat('setChatToIndex', '', open, value);
    },
    // Risu answers false when its permission is refused and throws for any other refusal.
    sendChat: async (message: string) => {
      const chat = await current();
      if (!chat) throw new Error('No active chat found');
      const answer = await chat.send(String(message));
      if (answer.ok) return true;
      if (answer.reason === 'not-allowed') return false;
      throw new Error(answer.reason === 'busy' ? 'A chat is already in progress' : `Risu API 'sendChat' failed in Hazelle: ${answer.reason}`);
    },
    runLLMModel: async ({ messages, mode, staticModel }: { messages: { role: string; content: unknown }[]; mode: string; staticModel?: string }) => {
      // A RisuAI model id, which nothing here may match to a connection by its name.
      if (staticModel !== undefined) return { type: 'fail', result: 'staticModel names a RisuAI model; Hazelle sends to the chat\'s own models only' };
      if (!messages.every((message) => MODEL_ROLES.has(message.role) && typeof message.content === 'string')) return { type: 'fail', result: 'only system, user and assistant text messages are sent' };
      const chat = await current();
      if (!chat) return { type: 'fail', result: 'no chat is open' };
      const answer = await chat.model(mode === 'model' ? 'main' : 'aux', messages as Hazelle.ModelMessage[]);
      return answer.ok ? { type: 'success', result: answer.text } : { type: 'fail', result: answer.reason };
    },
    addRisuReplacer: async (type: string, replacer: Replacer) => {
      if (!RISU_REPLACERS.has(type)) refuse(`addRisuReplacer:${type}`);
      replacers[type as keyof typeof replacers].add(replacer);
      listen(type === 'beforeRequest' ? 'requesting' : 'replying');
    },
    removeRisuReplacer: async (type: string, replacer: Replacer) => { replacers[type as keyof typeof replacers]?.delete(replacer); },
    addRisuScriptHandler: async (mode: string, handler: Handler) => {
      if (!Object.hasOwn(STAGES, mode)) refuse(`addRisuScriptHandler:${mode}`);
      handlers[mode as Mode].add(handler);
      listen(STAGES[mode as Mode]);
    },
    removeRisuScriptHandler: async (mode: string, handler: Handler) => { handlers[mode as Mode]?.delete(handler); },
    addRisuChatListener: async (_mode: 'output', listener: Listener) => { listeners.add(listener); },
    removeRisuChatListener: async (_mode: 'output', listener: Listener) => { listeners.delete(listener); },
    // Map only module-owned assets/<hash>.png paths; reject other folders and return null for unsaved/bot assets.
    saveAsset: async (data: Uint8Array) => `assets/${await api.assets.save(data)}.png`,
    readImage: async (path: string) => {
      const name = path.startsWith('assets/') ? path.slice('assets/'.length) : path;
      if (name.includes('/') || name.includes('\\')) throw new Error('readImage path cannot contain \'/\' or \'\\\', except the assets/ prefix');
      return name.endsWith('.png') ? api.assets.read(name.slice(0, -'.png'.length)) : null;
    },
    getTranslationCache: async (key: string) => (await translated()).find((entry) => entry.key === key)?.value ?? null,
    searchTranslationCache: async (partial: string) => (await translated()).filter(({ key }) => key.includes(partial)),
    // Read after the chat's last message, its setvar setting nothing as Risu's runVar left off does: an option that asks
    // for another reading fails it.
    parseRisuChat: async (text: string, { messageIndex = -1, runVar, processRegex, role, cbsConditions }: { messageIndex?: number; runVar?: boolean; processRegex?: boolean; role?: string; cbsConditions?: object } = {}) => {
      const unread = Object.entries({ messageIndex: messageIndex !== -1, runVar: runVar === true, processRegex: processRegex === true, role: role !== undefined, cbsConditions: cbsConditions !== undefined }).flatMap(([key, asked]) => (asked ? [key] : []));
      for (const key of unread) tell(`parseRisuChat:${key}`);
      if (unread.length) throw new Error(`Risu API 'parseRisuChat' cannot read with ${unread.join(', ')} in Hazelle`);
      const chat = await current();
      if (!chat) throw new Error('No active chat found');
      return chat.cbs(String(text ?? ''));
    },
    // Risu's inlay asset; type is the MIME type's own word (image, video, audio), as Risu's are.
    readInlay: async (id: string) => {
      const chat = await current();
      const inlay = chat && await chat.inlay(String(id));
      if (!inlay) return null;
      const [type, ext] = inlay.type.split('/');
      return { data: `data:${inlay.type};base64,${toBase64(inlay.bytes)}`, ext, name: id, type };
    },
    nativeFetch: fetchOf,
    // globalFetch defaults JSON requests to POST; rawResponse returns bytes.
    // Preserve Risu failure envelope even for malformed JSON: { ok: false, data: message, status: 400 }.
    risuFetch: async (url: string, arg: { body?: unknown; headers?: Record<string, string>; method?: 'GET' | 'POST'; rawResponse?: boolean; abortSignal?: AbortSignal } = {}) => {
      try {
        const response = await fetchOf(url, { method: arg.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...arg.headers }, body: JSON.stringify(arg.body), signal: arg.abortSignal ?? null });
        const data: unknown = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        return { ok: response.ok, data, headers: Object.fromEntries(response.headers), status: response.status };
      } catch (error) {
        return { ok: false, data: String(error), headers: {}, status: 400 };
      }
    },
  };
  const risu = new Proxy(mapped, {
    get: (target, name) => {
      if (typeof name === 'symbol' || name === 'then') return undefined;
      if (Object.hasOwn(target, name)) return target[name];
      if (!RISU_DECLINED.has(name)) return async () => refuse(name);
      tell(name);
      return undefined;
    },
  });

  // Risu's handlers answer null or undefined to leave the text as it is.
  const edited = async (mode: Mode, text: string) => {
    let content = text;
    for (const handler of [...handlers[mode]]) {
      const next = await handler(content);
      if (next === null || next === undefined) continue;
      if (typeof next !== 'string') throw new Error(`Risu ${mode} script handler answered no text`);
      content = next;
    }
    return content;
  };
  // Only the chat's own request and reply pass these stages, so Risu's request type is always 'model'.
  const stages: { [E in (typeof STAGES)[Mode]]: Hazelle.Events[E] } = {
    replying: (chat, text) => during(chat, async () => {
      let content = text;
      for (const replacer of [...replacers.afterRequest]) {
        const next = await replacer(content as never, 'model');
        if (typeof next === 'string') content = next;
      }
      return edited('output', content);
    }),
    sending: (chat, text) => during(chat, () => edited('input', text)),
    requesting: (chat, messages) => during(chat, async () => {
      const processed: Hazelle.RequestMessage[] = [];
      for (const message of messages) processed.push(message.message === undefined ? message : { ...message, content: await edited('process', message.content) });
      if (!replacers.beforeRequest.size) return processed;
      let risu: unknown = processed.map(({ role, content, message, cache }) => ({ role, content, ...(message !== undefined && { memo: message }), ...(cache && { cachePoint: true }) }));
      for (const replacer of [...replacers.beforeRequest]) risu = await replacer(risu as never, 'model');
      return fromRisu(risu, new Set(messages.flatMap(({ message }) => message ?? [])));
    }),
    showing: async (_chat, shown) => {
      const texts: string[] = [];
      for (const { text } of shown) texts.push(await edited('display', text));
      return texts;
    },
  };
  // What a replacer answers is sent only as Hazelle can send it: a message it cannot fails the stage, which sends the
  // request as it came; a field it cannot carry is told to 점검.
  const fromRisu = (answer: unknown, ids: Set<string>): Hazelle.RequestMessage[] => {
    if (!Array.isArray(answer)) throw new Error('Risu beforeRequest replacer answered no message list');
    return answer.map((message: unknown) => {
      const { role, content, memo, cachePoint, ...rest } = (message ?? {}) as Record<string, unknown>;
      if (typeof role !== 'string' || !MODEL_ROLES.has(role) || typeof content !== 'string') throw new Error(`Risu beforeRequest replacer answered a message Hazelle cannot send (role ${String(role)})`);
      for (const [key, value] of Object.entries(rest)) if (value !== undefined) tell(`addRisuReplacer:beforeRequest.${key}`);
      return { role: role as Hazelle.RequestMessage['role'], content, ...(typeof memo === 'string' && ids.has(memo) && { message: memo }), ...(cachePoint === true && { cache: true as const }) };
    });
  };
  // A stage is listened to once a hook needs it, so a chat waits on no plugin that has none (the host learns of a
  // listener added after load).
  const listening = new Set<keyof typeof stages>();
  const listen = (stage: keyof typeof stages) => {
    if (listening.has(stage)) return;
    listening.add(stage);
    api.on(stage, stages[stage] as never);
  };

  api.on('menu', (_chat, item) => press(buttons.get(item)?.run));
  api.on('action', (chat, item, message) => {
    const action = messageActions.get(item);
    if (!action) return;
    place(chat, message);
    press(() => action.run({ chatId: message.id, index: message.index }));
  });
  api.on('open', () => press(settings.values().next().value));
  api.on('reply', async (chat, reply) => {
    if (!listeners.size) return;
    const card = await chat.card();
    const char = card && await characterOf(chat, card);
    const arg = { char, chat: char ? char.chats[0]! : await read(chat), characterIndex: card ? await characterAt(card.id) : -1, chatIndex: chatNumber(chat.id), messageIndex: reply.index };
    for (const listener of [...listeners]) await listener(arg);
  });

  scope.Risuai = risu;
  scope.risuai = risu;
  // PluginSlots v1 is a porting shim, not Risu's API; map directly to Hazelle, never through Risuai
  // (research/risu-plugin-adapter-plan.md §9). Messages use the chatId returned by Risu-shaped chat reads.
  scope.PluginSlots = {
    version: 1,
    // On the version read when its chatId was handed out, which the picture was made for.
    attachPicture: async (chatId: string, bytes: Uint8Array, options: { caption?: string } = {}) => {
      const at = places.get(chatId);
      if (!at) throw new Error(`PluginSlots.attachPicture: no chat read here has message ${chatId}`);
      await at.chat.picture(at.at, bytes, options);
    },
    registerMessageAction: async ({ id, label }: { id: string; label: string }, callback: MessageAction) => {
      const previous = messageActions.get(id);
      messageActions.set(id, { label, run: callback });
      try {
        await frame.actions(listedActions());
      } catch (error) {
        if (previous) messageActions.set(id, previous);
        else messageActions.delete(id);
        throw error;
      }
    },
    removeMessageAction: async (id: string) => { if (messageActions.delete(id)) await frame.actions(listedActions()); },
  };
  // alert maps to a toast, never a blocking overlay. confirm/prompt must use allow-modals browser dialogs:
  // their synchronous answers cannot cross the host port.
  scope.alert = (message?: unknown) => { void current().then((chat) => chat ? chat.say(String(message)) : console.log(message)); };
  return () => { for (const unload of unloads) press(unload); };
}
