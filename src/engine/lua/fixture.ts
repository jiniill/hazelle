import type { Host } from '../script-api';
import type { Snapshot } from './state';

// A chat as Lua runs find it, shared by the engine's tests and the code editor's check of the API names.
export const OWNER = { kind: 'character', id: 'character' } as const;

export const SNAPSHOT: Snapshot = {
  messages: [
    { role: 'user', data: 'hello', time: 1 },
    { role: 'char', data: 'hi there', time: 2 },
  ],
  variables: [['hp', '10']],
  globals: [['toggle_hard', '1']],
  character: { name: 'Mina', description: 'a guide', firstMessage: 'welcome' },
  persona: { name: 'Jin', description: 'a traveler' },
  note: '',
  scope: {
    card: null,
    persona: { name: 'Jin', description: 'a traveler' },
    prompt: null,
    note: null,
    lore: [{ id: 'l1', parent: null, value: { name: 'Gate', keys: ['gate', 'door'], secondaryKeys: [], content: 'hp {{getvar::hp}}', enabled: true, constant: true, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 7, priority: null, position: null } }],
    loreFolders: {},
    loreScan: { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false },
    messages: [],
    variables: [],
    greeting: null,
    model: null,
    axModel: null,
    clock: { now: 0, timeZone: 'UTC' },
    assets: [],
    inlays: [],
    textfiles: [],
    modules: [],
    faces: { char: null, user: null },
    screen: null,
    pick: 'test',
  },
};

export const host = (over: Partial<Host> = {}): Host & { said: string[] } => {
  const said: string[] = [];
  return { said, say: (kind, text) => void said.push(`${kind}:${text}`), ask: async () => null, model: async () => ({ success: true, result: 'made' }), embed: async () => ({ ok: false, reason: 'no-model' }), tokens: async (text) => text.length, lore: async () => [{ role: 'assistant', text: 'active' }], background: async () => false, ...over };
};
