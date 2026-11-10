import type { ChatScope } from '../../engine/render';
import type { ScriptUnit } from '../../engine/script-api';
import { live } from '../../model/library';
import type { ToolUnit } from '../../model/tool';
import { packsOf, scopeOf } from '../chat/chat-context';
import type { ReadModels } from '../store/read-model';
import type { ObjectStore } from '../store/store';
import { toolsOf } from '../tools/store';

// Keep pack/trigger order and literal block-trigger names for button dispatch.
// Skip disabled/empty Lua so they cannot create engines or falsely mark a chat scripted; one with later effects runs
// them.
export const triggersOf = (packs: ReturnType<typeof packsOf>): ScriptUnit[] => packs.flatMap(({ id, pack, module }) =>
  pack.triggers.filter((trigger) => !trigger.off && (trigger.kind !== 'lua' || trigger.code.trim() || trigger.effects.length)).map((trigger) => ({
    ...trigger, ...(trigger.kind === 'lua' && { name: trigger.name || 'Lua' }), owner: { kind: module ? 'module' as const : 'character' as const, id },
  })),
);
// index counts from the first message after the greeting, as a tool reads it.
export const atOf = (scope: ChatScope, message: string): Hazelle.At | null => {
  const index = scope.messages.findIndex((each) => each.message === message);
  return index === -1 ? null : { index: index - (scope.greeting === null ? 0 : 1), id: message, version: scope.messages[index]!.id };
};

// The Lua triggers whose own code runs, which alone hear edits and the display.
export const scriptsOf = (packs: ReturnType<typeof packsOf>) => triggersOf(packs).filter((trigger): trigger is Extract<ScriptUnit, { kind: 'lua' }> => trigger.kind === 'lua' && trigger.code.trim() !== '');

export function unitFor(store: ObjectStore, chat: string, module: string): ToolUnit | null {
  const stored = live(store.get('chat', chat));
  return (stored && toolsOf(store, stored.value).find((unit) => unit.module === module)) ?? null;
}

export function scopeFor(session: { store: ObjectStore; read: ReadModels }, chat: string): ChatScope {
  return scopeOf(session, chat, session.store.get('chat', chat)!.value, session.store.foldedChat(chat).messages);
}
