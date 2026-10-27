import type { MemoryFill } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import { shown, type Chat, type Message } from '../model/chat';
import type { Stored } from '../model/kinds';
import { emptyMemory, memoryId, type Memory, type MemorySettings, type Source } from '../model/memory';
import { SETTINGS_ID } from '../model/settings';
import type { ToolUnit } from '../model/tool';
import { featuresOf } from './features';
import type { ObjectStore } from './store';
import { toolsOf } from './tools/store';

// budget, window and batch count tokens (model/memory MemorySettings).
export const MEMORY_DEFAULTS: MemorySettings = { on: true, budget: 25_000, window: 24_000, batch: 12_000 };

export type MemorySetup = MemorySettings & { own: boolean };

export const defaultMemory = (store: Pick<ObjectStore, 'get'>): MemorySettings => ({ ...MEMORY_DEFAULTS, ...store.get('settings', SETTINGS_ID)?.value.memory });

export const memorySetup = (store: Pick<ObjectStore, 'get'>, chat: Chat): MemorySetup => (chat.memory ? { ...chat.memory, own: true } : { ...defaultMemory(store), own: false });

export const storedMemory = (store: Pick<ObjectStore, 'children'>, chat: string): Stored<'memory'> | undefined => store.children('memory', chat).find((entry) => entry.id === memoryId(chat));

export const chatMemory = (store: Pick<ObjectStore, 'children'>, chat: string): Memory => storedMemory(store, chat)?.value ?? emptyMemory();

export const sourcesOf = (messages: Message[]): Source[] => messages.map((message) => ({ message: message.id, version: shown(message).id }));

// First consented tool in pack order owns the slot, regardless of built-in memory feature switches.
// Unanswered claims leave built-in memory active while its setting/feature permit it.
type MemoryOwner = { kind: 'built-in'; setup: MemorySetup } | { kind: 'tool'; unit: ToolUnit } | null;

export function memoryOwner(store: ObjectStore, chat: Chat): MemoryOwner {
  const unit = toolsOf(store, chat).find(({ module, tool }) => tool.manifest.uses.includes('memory') && store.get('module', module)?.value.takesMemory === true);
  if (unit) return { kind: 'tool', unit };
  const setup = memorySetup(store, chat);
  return setup.on && featuresOf(store, chat).memory ? { kind: 'built-in', setup } : null;
}

const shownOf = (messages: ChatScope['messages']) => messages.map(({ message, id: version }) => ({ message, version }));

// A tool covers no messages until its prompt answer arrives. Unsaved chats (id null) have no memory.
export function memoryFill(store: ObjectStore, id: string | null, chat: Chat, messages: ChatScope['messages']): MemoryFill | null {
  const owner = memoryOwner(store, chat);
  if (owner?.kind === 'tool') return { kind: 'tool', name: owner.unit.tool.manifest.displayName, text: '', through: -1 };
  return owner && { kind: 'built-in', memory: id === null ? emptyMemory() : chatMemory(store, id), budget: owner.setup.budget, shown: shownOf(messages), found: [] };
}

// The same slot over the scope a turn's scripts leave (ScriptPreview.rehearse).
export const memoryOver = (fill: MemoryFill | null, messages: ChatScope['messages']): MemoryFill | null => (fill?.kind === 'built-in' ? { ...fill, shown: shownOf(messages) } : fill);
