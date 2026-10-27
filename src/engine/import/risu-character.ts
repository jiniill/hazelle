import { splitThoughts } from '../../connectors/thoughts';
import { isRecord, list } from '../../connectors/values';
import { inlayIds } from '../assets';
import { assemble, imageType, type Resolve } from './card';
import { add, chatLorebook, convert, counted, finite, record, text, type Json, type Tally } from './convert';
import { MOVE_UNSUPPORTED_KINDS, type MoveUnsupported, type MoveUnsupportedKind, type Picture, type RisuCharacter, type RisuChat } from './types';

export type Read = () => Promise<Uint8Array<ArrayBuffer>>;
// The backup's entry for a Risu asset key; null when the backup lacks it.
export type Entry = (key: string) => Read | null;

const messageTexts = (messages: unknown[]) => messages.filter(isRecord).map((message) => text(message.data));

// inlays: how many of Risu's inlay items the chat's messages name.
export function chatInfo(chat: Json | null): { lastTalk: number; inlays: number } | null {
  const messages = list(chat?.message);
  if (!messages.length) return null;
  const inlays = inlayIds(messageTexts(messages)).length;
  let hasMessage = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!isRecord(message)) continue;
    hasMessage = true;
    const at = finite(message.time);
    if (at !== null) return { lastTalk: at, inlays };
  }
  return { lastTalk: hasMessage ? (finite(chat!.lastDate) ?? 0) : 0, inlays };
}

export async function picture(read: Read): Promise<Picture | null> {
  const bytes = await read();
  const type = imageType(bytes);
  return type ? { bytes, type } : null;
}

// Restore selected chats at original positions and apply Risu open-time migrations (spec §8).
// Missing cold payloads stay null.
export function risuCharacter(char: Json, chats: (Json | null)[], folder: string | null, entry: Entry): RisuCharacter {
  const missed: Tally<MoveUnsupportedKind> = new Map();
  const tally: Tally = new Map();
  // cardJson always builds a v3 card with data, which convert never refuses.
  const converted = convert(cardJson(char), null, tally, list(char.globalLore))!;
  // Any uri other than a Risu asset key points outside the backup.
  const resolve: Resolve = (uri) => {
    const read = uri.startsWith('assets/') ? entry(uri) : null;
    if (!read) add(missed, 'missing-picture');
    return read;
  };
  const imported = assemble('json', converted, resolve, tally);
  const image = text(char.image) && entry(text(char.image));
  if (image === null) add(missed, 'missing-picture');

  const page = Number.isInteger(char.chatPage) && chats[char.chatPage as number] ? (char.chatPage as number) : 0;
  const fmIndex = finite(char.firstMsgIndex) ?? -1;
  // Risu turns a module on for one chat too, a place this app does not have: a chat's are on for its character
  // (design §6.5). Only a chat that comes brings its own.
  const modules = new Set(list(char.modules).filter((id) => typeof id === 'string'));
  const brought = chats.flatMap((chat, index) => {
    if (!chat) {
      add(missed, 'cold-missing');
      return [];
    }
    if (list(chat.message).length === 0) return [];
    for (const id of list(chat.modules)) if (typeof id === 'string') modules.add(id);
    // Risu moves the old post-history text into the open chat's note when the character is next opened.
    const note = index === page && text(char.postHistoryInstructions) ? `${text(chat.note)}\n${text(char.postHistoryInstructions)}`.trim() : text(chat.note);
    return [risuChat(chat, note, fmIndex, missed)];
  });
  add(missed, 'chat-folder', list(char.chatFolders).length);
  if (char.escapeOutput === true) add(missed, 'escape-output');
  const note = text(char.translatorNote);

  return {
    ...imported,
    own: note.trim() ? { character: { translatorNote: note }, likeness: null } : null,
    id: text(char.chaId),
    avatar: image ? () => picture(image) : () => Promise.resolve(null),
    folder,
    chats: brought,
    modules: [...modules],
    missed: counted(MOVE_UNSUPPORTED_KINDS, missed),
  };
}

// Risu's export of one chat (risuChat) or of a character's every chat (risuAllChats); null for any other JSON. Risu
// reads data as a list or as one chat at either version, and so does this.
export function risuChatFile(json: unknown): { chats: RisuChat[]; missed: MoveUnsupported[] } | null {
  if (!isRecord(json) || (json.type !== 'risuChat' && json.type !== 'risuAllChats') || (json.ver !== 1 && json.ver !== 2)) return null;
  const missed: Tally<MoveUnsupportedKind> = new Map();
  const chats = (Array.isArray(json.data) ? json.data : [json.data]).filter(isRecord).map((chat) => risuChat(chat, text(chat.note), -1, missed));
  // A file of chats brings none of their pictures.
  add(missed, 'inlay', chats.reduce((sum, chat) => sum + chat.inlays.length, 0));
  return { chats, missed: counted(MOVE_UNSUPPORTED_KINDS, missed) };
}

function risuChat(chat: Json, note: string, fmIndex: number, missed: Tally<MoveUnsupportedKind>): RisuChat {
  const messages = list(chat.message).filter(isRecord);
  let at = finite(chat.lastDate) ?? 0;
  // 'allBefore' leaves it and every message before it out of the prompt.
  const cut = messages.findLastIndex((message) => message.disabled === 'allBefore');
  for (const [index, message] of messages.entries()) {
    if (index <= cut || message.disabled === true || message.isComment === true) add(missed, 'hidden-message');
  }
  if (text(chat.supaMemoryData).trim() || [chat.hypaV2Data, chat.hypaV3Data].some(holdsData)) add(missed, 'memory');
  // Read local toggles regardless of useLocallySetGlobalVariables, which only selects a write target.
  // Empty/'null' means unset (chatVar.svelte.ts getGlobalChatVar).
  if (Object.entries(record(chat.GLGlobalVariables)).some(([key, value]) => key.startsWith('toggle_') && value && value !== 'null')) add(missed, 'chat-toggles');
  const marked = new Set(list(chat.bookmarks).filter((id) => typeof id === 'string'));
  const names = record(chat.bookmarkNames);
  return {
    title: text(chat.name),
    note: note.trim() ? note : null,
    persona: text(chat.bindedPersona) || null,
    greeting: Math.max((finite(chat.fmIndex) ?? fmIndex) + 1, 0),
    variables: Object.entries(record(chat.scriptstate)).flatMap(([key, value]): [string, string][] =>
      key.startsWith('$') && value !== undefined ? [[key.slice(1), typeof value === 'string' ? value : JSON.stringify(value)]] : [],
    ),
    inlays: inlayIds(messageTexts(messages)),
    ...chatLorebook(list(chat.localLore)),
    messages: messages.map((message) => {
      at = finite(message.time) ?? at;
      // Risu keeps a reply's reasoning inside its text as <Thoughts> blocks, and takes them out again before it draws or
      // sends the text (ParseMarkdown, and the prompt builder).
      const { text: said, reasoning } = splitThoughts(text(message.data));
      const name = typeof message.chatId === 'string' && marked.has(message.chatId) ? text(names[message.chatId]).trim() : null;
      return { role: message.role === 'user' ? 'user' : 'assistant', text: said, at, ...(reasoning && { reasoning }), ...(name !== null && { bookmark: name ? { name } : {} }) };
    }),
  };
}

const holdsData = (memory: unknown) => isRecord(memory) && Object.values(memory).some((value) => Array.isArray(value) && value.length > 0);

// Feed the shared card converter a v3-shaped record; keep scripts/triggers in extensions.risuai.
// Do not reproduce Risu export artifacts: literal undefined version or ccdefault icon with a separate avatar.
function cardJson(char: Json): Json {
  const settings = record(char.loreSettings);
  const extras = record(char.additionalData);
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: char.name,
      description: char.desc,
      personality: char.personality,
      scenario: char.scenario,
      first_mes: char.firstMessage,
      mes_example: char.exampleMessage,
      creator_notes: char.creatorNotes,
      system_prompt: char.systemPrompt,
      post_history_instructions: char.replaceGlobalNote,
      alternate_greetings: char.alternateGreetings,
      character_book: {
        scan_depth: settings.scanDepth,
        token_budget: settings.tokenBudget,
        recursive_scanning: settings.recursiveScanning,
        extensions: { risu_fullWordMatching: settings.fullWordMatching ?? false },
      },
      tags: char.tags,
      creator: extras.creator,
      character_version: extras.character_version,
      extensions: {
        risuai: {
          bias: char.bias,
          customScripts: char.customscript,
          utilityBot: char.utilityBot,
          backgroundHTML: char.backgroundHTML,
          triggerscript: char.triggerscript,
          additionalText: char.additionalText,
          defaultVariables: char.defaultVariables,
          prebuiltAssetCommand: char.prebuiltAssetCommand,
          largePortrait: char.largePortrait,
          viewScreen: char.viewScreen,
          toggles: char.customModuleToggle,
        },
        depth_prompt: char.depth_prompt,
      },
      nickname: char.nickname,
      assets: [
        ...list(char.ccAssets),
        ...list(char.additionalAssets)
          .filter(Array.isArray)
          .map(([name, uri]) => ({ type: 'x-risu-asset', uri, name })),
        ...list(char.emotionImages)
          .filter(Array.isArray)
          .map(([name, uri]) => ({ type: 'emotion', uri, name })),
      ],
    },
  };
}
