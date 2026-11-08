import type { ScriptUnit } from '../../engine/script-api';
import type { Lua, RunLane } from '../../engine/lua/run';
import type { Event, Host } from '../../engine/script-api';
import type { ChatScope } from '../../engine/render';
import type { ScriptOutcome } from './lua/event';

export type Binding<U, E extends Event = Event, H extends Host = Host> = { run(chat: string, units: U, scope: ChatScope, event: E, host: H, signal?: AbortSignal): Promise<ScriptOutcome>; close(): void };
export type LuaRunner = Pick<Binding<ScriptUnit[]>, 'close'> & Pick<Lua, 'installDisplay' | 'display' | 'forgetDisplay' | 'check'> & { run(chat: string, units: ScriptUnit[], scope: ChatScope, event: Event, host: Host, lane: RunLane, signal?: AbortSignal): Promise<ScriptOutcome> };

export class ToolStuck extends Error {
  constructor(readonly disabled: boolean) { super(); }
}
export class ToolLate extends Error {}
export class ToolStopped extends Error {}
export const aborted = (signal: AbortSignal): Error => signal.reason instanceof ToolLate || signal.reason instanceof ToolStuck ? signal.reason : new ToolStopped();

export function until<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted(signal));
  let stop = () => {};
  const stopped = new Promise<never>((_, reject) => { stop = () => reject(aborted(signal)); signal.addEventListener('abort', stop, { once: true }); });
  return Promise.race([promise, stopped]).finally(() => signal.removeEventListener('abort', stop));
}
export const noOutcome = (): ScriptOutcome => ({ value: undefined, stop: false, handled: false, writes: [], edits: [], removed: [], added: [], reload: false, lore: [], errors: [], missing: [] });
