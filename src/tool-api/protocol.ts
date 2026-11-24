import type { Json, Settings, ToolManifest } from './manifest';

export type EventName = keyof Hazelle.Events;
export type ChatHeader = Pick<Hazelle.Chat, 'id' | 'character' | 'persona' | 'length'>;
export type Message = Hazelle.Message;
// data undefined deletes; badges use message indices with null to clear.
// lore replaces chat-owned entries by name; variables writes shared bot variables, not tool state, undefined unsetting one.
export type ToolOutcome = {
  value?: Hazelle.PromptAnswer | Hazelle.RequestMessage[] | string[]; writes: [string, Json | undefined][]; edits: { index: number; text: string }[]; removed: number[]; added: { role: 'user' | 'char'; text: string }[];
  data: [string, Json | undefined][]; badges: { index: number; text: string | null }[]; lore: Omit<Hazelle.LoreEntry, 'owner'>[];
  variables: [string, string | undefined][];
};
export type Method =
  | 'chat.messages' | 'chat.greeting' | 'chat.card' | 'chat.state.get' | 'chat.variables.get' | 'chat.variables.entries' | 'chat.data.get' | 'chat.data.keys' | 'chat.lorebook' | 'chat.inlay' | 'chat.asset' | 'chat.cbs' | 'chat.setup' | 'chat.picture' | 'chat.send' | 'chat.rendered' | 'chat.card.edit' | 'model' | 'embed' | 'decide' | 'draw' | 'fetch' | 'ask' | 'say' | 'progress' | 'tokens' | 'lore'
  | 'storage.get' | 'storage.set' | 'storage.delete' | 'storage.keys' | 'assets.save' | 'assets.read' | 'settings' | 'settings.set' | 'account' | 'post' | 'page.close' | 'frame.chat' | 'frame.show' | 'frame.hide' | 'frame.menu' | 'frame.actions' | 'frame.missing' | 'frame.layer' | 'frame.missed';
// A method as a plugin's code names it (hazelle.d.ts), for a test run's record of its calls; the arguments stay as sent.
const ON_CHAT = new Set<string>(['model', 'embed', 'decide', 'draw', 'fetch', 'ask', 'say', 'progress', 'tokens', 'lore'] satisfies Method[]);
const RENAMED: Partial<Record<string, string>> = { 'chat.card.edit': 'chat.editCard', 'settings.set': 'hazelle.setSetting' } satisfies Partial<Record<Method, string>>;
export const called = (method: string) => RENAMED[method] ?? (method.startsWith('chat.') ? method : ON_CHAT.has(method) ? `chat.${method}` : `hazelle.${method}`);
export const LOG_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
export type Role = 'background' | 'page' | 'frame';
export type Down =
  // console: a test run, whose console output is sent up as log.
  | { kind: 'load'; api: 1; role: Role; code: string; manifest: ToolManifest; settings: Settings; chat: ChatHeader | null; theme: 'dark' | 'light'; colors?: Hazelle.Colors; console?: true }
  | { kind: 'event'; id: number; event: EventName; chat: ChatHeader | null; reply?: Hazelle.At; turn?: Hazelle.Turn; change?: Hazelle.Change; from?: Hazelle.Branched; item?: string; message?: Hazelle.At; text?: string; messages?: Hazelle.RequestMessage[]; role?: 'main' | 'aux'; shown?: Hazelle.Shown[]; name?: string; args?: { [key: string]: Hazelle.Json } }
  | { kind: 'answer'; call: number; ok: boolean; value: unknown }
  | { kind: 'storage'; keys: string[] }
  | { kind: 'message'; data: Json }
  | { kind: 'settings'; values: Settings }
  | { kind: 'open' }
  | { kind: 'layer'; on: boolean; theme: 'dark' | 'light' }
  | { kind: 'ping' };
export type Up =
  | { kind: 'loaded'; listens: EventName[] }
  // line: in the file, when the error's stack names it.
  | { kind: 'load-failed'; message: string; line?: number }
  | { kind: 'done'; id: number; outcome: ToolOutcome }
  | { kind: 'failed'; id: number; message: string; line?: number }
  | { kind: 'call'; call: number; event?: number; method: Method; args: unknown[] }
  | { kind: 'cancel'; call: number }
  | { kind: 'log'; level: (typeof LOG_LEVELS)[number]; text: string }
  | { kind: 'pong' };

export type Port = Pick<MessagePort, 'onmessage' | 'postMessage' | 'start' | 'close'>;
