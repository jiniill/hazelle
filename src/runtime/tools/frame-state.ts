import type { ToolEvent, ToolReach } from '../../engine/script-api';
import type { ChatScope } from '../../engine/render';
import type { Tool } from '../../model/tool';
import type { Json } from '../../tool-api/manifest';
import type { EventName, Message } from '../../tool-api/protocol';
import type { FileRef } from '../../vault/files';
import type { ToolState } from '../evaluation/evaluation-core';
import type { ScriptOutcome } from '../scripts/lua/event';
import type { Heartbeat } from '../worker';
import type { LayerRegion, MenuItem, ToolPage, ToolSlot } from './facade';
import type { Connection } from './frame';

// event: absent for a page's own calls and writes.
export type Context = { chat: string; scope: ChatScope; host: ToolReach; signal: AbortSignal; state?: Promise<ToolState>; event?: ToolEvent['kind'] };
type Pending = Context & { cancel: AbortController; resolve(outcome: ScriptOutcome): void; reject(error: Error): void; stop(): void };
export type Frame = {
  id: number; entry: Entry; connection: Connection; page?: ToolPage; closing: AbortController; heart: Heartbeat;
  loaded: boolean; ready: Promise<void>; resolve(): void; reject(error: Error): void; loadTimer: ReturnType<typeof setTimeout> | null;
  listens: Set<EventName>; pending: Map<number, Pending>; calls: Map<number, AbortController>; messages: Message[];
  reading: Promise<unknown>; lanes: Set<string>; release(): void;
  // The state its calls outside an event read, while the store has not changed since (ToolHost changed) and its chat's
  // messages are the ones it was read over: a write can land in the store before it is published. Within its minute
  // only, so what a bot shows of the time is never older than that.
  outside: { chat: string; messages: object; minute: number; state: Promise<ToolState> } | null;
  // Opened with the sandbox's network variant (pictures and fonts from outside), fixed for the frame's life.
  network: boolean;
  // Ended, with its port still open while the connection lets its unload callbacks run: their calls are answered.
  unloading: boolean;
};
// Frame tools run in the background frame. Outside-event calls use chat; menu/actions/shown are live registrations.
// leaving lasts one commit so reattaching a slot is a remount, not a close.
// A studio draft's test run (ToolHost.trial), its code held as text. What it would write outside its outcome lands in
// its own copy (storage, settings) or is refused, each listed in writes. installed: the module of the plugin its file
// would replace, whose stored data (storage, chat data, saved files) the run reads under its own writes; null: none, so
// it reads nothing stored. storage: what the run wrote, undefined for a key it deleted.
export type TrialWrite = { kind: 'storage' | 'setting'; key: string; value: Json | undefined } | { kind: 'refused'; call: 'assets.save' | 'chat.picture' | 'chat.send' | 'chat.card.edit' };
// One call a test run made of the app, named as its code names it (protocol called), or a console line it wrote: its
// arguments as sent and its answer, as cut text. gave null: not answered when the calls were read. failed: gave is what
// the call threw; a console.error.
export type TrialCall = { method: string; args: string; gave: string | null; failed: boolean };
// made: in the order made, up to TRIAL_CALLS. omitted: how many came after.
export type TrialCalls = { made: TrialCall[]; omitted: number };
export const noCalls = (): TrialCalls => ({ made: [], omitted: 0 });
export type EntryTrial = { code: string; chat: string; installed: string | null; storage: Map<string, Json | undefined>; writes: TrialWrite[]; calls: TrialCalls };
export type EntryCode = { file: FileRef; trial: null } | { file: null; trial: EntryTrial };
export type Entry = EntryCode & {
  module: string; tool: Pick<Tool, 'manifest' | 'settings'>; settings: string; background: Frame | null; pages: Set<Frame>; chats: Set<string>; idle: ReturnType<typeof setTimeout> | null; data: Map<string, { key: string; json: string }>;
  chat: string | null; menu: MenuItem[]; actions: MenuItem[]; shown: boolean; slot: ToolSlot | null; leaving: boolean;
  region: LayerRegion;
};
export const isFrameTool = (tool: Pick<Tool, 'manifest'>) => tool.manifest.risu !== undefined;
// A run's error with its line in the file, when the sandbox could tell it.
export class ToolFailure extends Error {
  constructor(message: string, readonly line: number | null) { super(message); }
}
