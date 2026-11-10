import type { Unpacked } from '../../engine/import/archive';
import type { PresetRead } from '../../engine/import/preset';
import type { ImportedTool } from '../../engine/import/tool';
import type { BackupCatalog, BackupFailure, BundledModule, Imported, ImportedModule, ImportedPersona, ImportFailure, MoveUnsupported, Picture, RisuCharacter, RisuChat, RisuMessage, RisuPersona, RisuPreset } from '../../engine/import/types';
import type { ChatFile } from '../export/chat-file';

export type AssetRead = Omit<Imported['assets'][number], 'read'> & { handle: number };
export type PartRead = { path: string; handle: number };
export type ModuleData = Omit<ImportedModule, 'assets'> & { assets: AssetRead[] };
export type CardData = Omit<Imported, 'avatar' | 'assets' | 'bundled'> & { avatar: number | null; assets: AssetRead[]; bundled: (ModuleData & Pick<BundledModule, 'likeness'>)[] };
export type CharacterData = Omit<RisuCharacter, 'avatar' | 'assets' | 'chats'> & { avatar: number; assets: AssetRead[]; chatCount: number };
type PersonaData = Omit<RisuPersona, 'picture' | 'module'> & { picture: number; module: ModuleData | null };
type PersonaFileData = Omit<ImportedPersona, 'picture'> & { picture: number };
// A file of chats, which a JSON card file may be instead: this app's own, or Risu's.
export type ChatsRead = { ok: true; chat: ChatFile } | { ok: true; risuChats: RisuChat[]; missed: MoveUnsupported[] };

type Inputs = {
  backup: { files: File[] };
  card: { file: File; asModule: boolean; password?: string };
  zip: { file: File };
  character: { key: number };
  persona: { key: number };
  preset: { key: number };
  module: { key: number };
  chat: { index: number };
  messages: { index: number; from: number };
  release: object;
  original: object;
  asset: { handle: number };
  picture: { handle: number };
};
export type Replies = {
  zip: Unpacked<File>;
  backup: { ok: true; catalog: BackupCatalog } | { ok: false; failure: BackupFailure };
  card: { ok: true; tool: ImportedTool } | { ok: true; preset: PresetRead } | { ok: true; card: CardData } | { ok: true; module: ModuleData } | { ok: true; persona: PersonaFileData } | ChatsRead | { ok: false; failure: ImportFailure };
  character: CharacterData;
  persona: PersonaData;
  preset: RisuPreset;
  module: ModuleData;
  chat: { header: Omit<RisuChat, 'messages'>; messages: number };
  messages: { messages: RisuMessage[]; next: number };
  release: null;
  // The pieces of the last card file read, which their 'asset' handles give.
  original: PartRead[];
  asset: Uint8Array<ArrayBuffer> | null;
  picture: Picture | null;
};
export type Method = keyof Inputs;
export type Request<K extends Method = Method> = { [M in K]: { kind: M } & Inputs[M] }[K];
export type Down<K extends Method = Method> = { id: number; request: Request<K> } | { ping: true };
// pong answers a ping; progress is a sign of life from inside one long read (engine/progress).
export type Up = { id: number; result: Replies[Method] } | { id: number; error: string } | { pong: true } | { progress: true };

export const MESSAGE_PAGE = 256;
export const MESSAGE_BYTES = 1_000_000;
export class ImportReadError extends Error {}
// The worker went STUCK_MS (client.ts) without a sign of life, held by a file it cannot finish reading.
export class ImportStuck extends ImportReadError {}
