import type { Event, Host, Outcome, ScriptUnit } from '../../../engine/script-api';
import type { HookTrace, Lua, RunLane } from '../../../engine/lua/run';
import { renderChat, type ChatScope } from '../../../engine/render';
import { luaSnapshot, luaStanding } from './snapshot';

// tool: what a tool's run did to its own data for the chat, and to its badges by message index (runtime/tools/store
// saveToolChat); Lua has neither. trace: Lua's hook log; a tool's run has none.
export type ScriptOutcome = Omit<Outcome, 'edits'> & { edits: (Outcome['edits'][number] & { wrote: [string, string][] })[]; tool?: { data: [string, Hazelle.Json | undefined][]; badges: { index: number; text: string | null }[] }; trace?: HookTrace };

// The chat replayed as a run reads it, but for the scope's pending, which runEvent sets on top: renderChat sets pending
// after every message, so the two read as one replay with it.
export type Replay = Pick<ReturnType<typeof renderChat>, 'staged' | 'wrote' | 'variables'>;
export const replayChat = (scope: ChatScope): Replay => renderChat('prompt', { ...scope, pending: [] });

export async function runEvent(machine: Lua, owner: string, triggers: ScriptUnit[], scope: ChatScope, event: Event, host: Host, lane: RunLane, signal?: AbortSignal, replay = replayChat(scope)): Promise<ScriptOutcome> {
  const { staged, wrote } = replay;
  const variables = new Map(replay.variables);
  for (const [name, value] of scope.pending ?? []) variables.set(name, value);
  const snapshot = luaSnapshot(scope, luaStanding(scope), staged, [...variables]);
  const outcome = await machine.run(owner, triggers, snapshot, event, host, lane, signal);
  const greeting = scope.greeting === null ? 0 : 1;
  return { ...outcome, edits: outcome.edits.map(edit => ({ ...edit, wrote: wrote[edit.index + greeting]! })) };
}
