import { TOGGLE_GLOBAL } from '../../engine/cbs/tags';
import type { Snapshot } from '../../engine/lua/state';
import { personaName } from '../../engine/memory';
import { authorNote, type ChatScope } from '../../engine/render';

// What Lua's own functions read of a chat besides its messages and variables; its CBS and lorebook reads go through
// the snapshot's scope. An editDisplay pass run on one is not fresh for another (ScriptDisplay).
type LuaStanding = Pick<Snapshot, 'globals' | 'character' | 'persona' | 'note'>;

// The card without its scripts and triggers, which no tag reads and a run is handed apart. No inlays: Lua's CBS
// runs as the prompt does, which reads none.
function cbsScope({ card, persona, prompt, note, lore, loreFolders, loreScan, messages, variables, greeting, model, axModel, clock, assets, modules, faces, screen, pick }: ChatScope): Snapshot['scope'] {
  return { card: card && { ...card, regex: [], triggers: [] }, persona, prompt, note, lore, loreFolders, loreScan, messages, variables, greeting, model, axModel, clock, assets, inlays: [], textfiles: [], modules, faces, screen, pick };
}

export function luaSnapshot(scope: ChatScope, standing: LuaStanding, staged: string[], variables: [string, string][]): Snapshot {
  const greeting = scope.greeting === null ? 0 : 1;
  return {
    messages: scope.messages.slice(greeting).map(({ role, time }, index) => ({ role: role === 'user' ? 'user' : 'char', data: staged[index + greeting]!, time: time ?? 0 })),
    variables,
    ...standing,
    scope: cbsScope(scope),
  };
}

export function luaStanding(scope: ChatScope): LuaStanding {
  return {
    globals: [...scope.toggles].map(([key, value]) => [`${TOGGLE_GLOBAL}${key}`, value ?? '']),
    character: { name: scope.card?.name ?? '', description: scope.card?.description ?? '', firstMessage: scope.card?.greetings[0] ?? '' },
    persona: { name: personaName(scope.persona), description: scope.persona?.description ?? '' },
    note: scope.prompt ? authorNote(scope.note, scope.prompt) : (scope.note ?? ''),
  };
}
