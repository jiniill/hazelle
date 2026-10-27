import type { ToolEvent, ToolReach } from '../../engine/script-api';
import type { ChatScope } from '../../engine/render';
import type { Tool } from '../../model/tool';
import type { EventName, Message } from '../../tool-api/protocol';
import type { ToolState } from '../evaluation-core';
import type { ScriptOutcome } from '../lua/event';
import type { Heartbeat } from '../worker';
import type { MenuItem, ToolPage, ToolSlot } from './facade';
import type { Connection } from './frame';

// event: absent for a page's own calls and writes.
export type Context = { chat: string; scope: ChatScope; host: ToolReach; signal: AbortSignal; state?: Promise<ToolState>; event?: ToolEvent['kind'] };
type Pending = Context & { cancel: AbortController; resolve(outcome: ScriptOutcome): void; reject(error: Error): void; stop(): void };
export type Frame = {
  id: number; entry: Entry; connection: Connection; page?: ToolPage; closing: AbortController; heart: Heartbeat;
  loaded: boolean; ready: Promise<void>; resolve(): void; reject(error: Error): void; loadTimer: ReturnType<typeof setTimeout> | null;
  listens: Set<EventName>; pending: Map<number, Pending>; calls: Map<number, AbortController>; messages: Message[];
  reading: Promise<unknown>; lanes: Set<string>; release(): void;
  // Opened with the sandbox's network variant (pictures and fonts from outside), fixed for the frame's life.
  network: boolean;
  // Ended, with its port still open while the connection lets its unload callbacks run: their calls are answered.
  unloading: boolean;
};
// Frame tools run in the background frame. Outside-event calls use chat; menu/actions/shown are live registrations.
// leaving lasts one commit so reattaching a slot is a remount, not a close.
export type Entry = {
  module: string; tool: Tool; settings: string; background: Frame | null; pages: Set<Frame>; chats: Set<string>; idle: ReturnType<typeof setTimeout> | null; data: Map<string, { key: string; json: string }>;
  chat: string | null; menu: MenuItem[]; actions: MenuItem[]; shown: boolean; slot: ToolSlot | null; leaving: boolean;
};
export const isFrameTool = (tool: Tool) => tool.manifest.risu !== undefined;
