import type { Event, Host, Outcome, ScriptUnit } from '../../../engine/script-api';
import type { HookTrace, Lua, RunLane } from '../../../engine/lua/run';
import { renderChat, type ChatScope } from '../../../engine/render';
import { luaSnapshot, luaStanding } from './snapshot';

// tool: what a tool's run did to its own data for the chat, and to its badges by message index (runtime/tools/store
// saveToolChat); Lua has neither. trace: Lua's hook log; a tool's run has none.
export type ScriptOutcome = Omit<Outcome, 'edits'> & { edits: (Outcome['edits'][number] & { wrote: [string, string][] })[]; tool?: { data: [string, Hazelle.Json | undefined][]; badges: { index: number; text: string | null }[] }; trace?: HookTrace };

export async function runEvent(machine: Lua, owner: string, triggers: ScriptUnit[], scope: ChatScope, event: Event, host: Host, lane: RunLane, signal?: AbortSignal): Promise<ScriptOutcome> {
  const { staged, wrote, variables } = renderChat('prompt', scope);
  const snapshot = luaSnapshot(scope, luaStanding(scope), staged, [...variables]);
  const outcome = await machine.run(owner, triggers, snapshot, event, host, lane, signal);
  const greeting = scope.greeting === null ? 0 : 1;
  return { ...outcome, edits: outcome.edits.map(edit => ({ ...edit, wrote: wrote[edit.index + greeting]! })) };
}
