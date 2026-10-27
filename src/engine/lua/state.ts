import type { Lore, PackOwner } from '../../model/library';
import { UNSET, type Host } from '../script-api';
import { unescapeCbs } from '../cbs/escape';
import { evaluate, Runaway } from '../cbs/evaluate';
import { TOGGLE_GLOBAL } from '../cbs/tags';
import { contexts, type ChatScope } from '../render';

// A message as a script reads it: role and data are Risu's names, which bots index by.
export type LuaMessage = { role: 'user' | 'char'; data: string; time: number };

// Snapshot excludes greeting; messages are post-script, variables are story-local, globals carry toggles.
// scope omits non-worker data and fields scripts cannot read (packs, cast, duplicate toggles).
export type Snapshot = {
  messages: LuaMessage[];
  variables: [string, string][];
  globals: [string, string][];
  scope: Omit<ChatScope, 'toggles' | 'packs' | 'pending' | 'cast'>;
  character: { name: string; description: string; firstMessage: string };
  persona: { name: string; description: string };
  note: string;
};

export type Working = { origin: number | null; role: 'user' | 'char'; data: string; time: number; first: string };

// Quiet display runs discard writes/external effects. Overlay writes in written; never mutate variables.
// ranAway carries a CBS stop because the Lua boundary converts Runaway to Error.
// chat parents local lore writes, which replace entries by name.
export type Run = {
  owner: PackOwner | null;
  chat: string;
  lore: Map<string, Omit<Lore, 'folder'>>;
  quiet: boolean;
  snapshot: Snapshot;
  variables: ReadonlyMap<string, string>;
  globals: ReadonlyMap<string, string>;
  written: Map<string, string>;
  messages: Working[];
  host: Host | null;
  signal?: AbortSignal;
  stop: boolean;
  reload: boolean;
  missing: Set<string>;
  ranAway: boolean;
  // The risu-id of the element whose press called this run (CbsContext triggerId); '' for any other run.
  triggerId: string;
  // The background this run saved, which its later reads see before the snapshot's.
  background?: string;
};
export type Acting = Run & { host: Host; owner: PackOwner };

export const working = (snapshot: Snapshot): Working[] => snapshot.messages.map((message, origin) => ({ ...message, origin, first: message.data }));

export const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

export const read = (run: Run, name: string) => run.written.get(name) ?? run.variables.get(name) ?? UNSET;

// A nil write unsets the name, and Risu reads an unset name as the card's default or 'null' (parser/chatVar.svelte.ts
// getChatVar). That reading is what is written, so the replay applies an unset as any other write.
export function write(run: Run, name: string, value: unknown): boolean {
  const next = value === undefined || value === null ? (run.snapshot.scope.card?.variables.find(([key]) => key === name)?.[1] ?? UNSET) : text(value);
  if ((run.written.get(name) ?? run.variables.get(name)) === next) return false;
  run.written.set(name, next);
  return true;
}

export const add = (run: Run, role: Working['role'], data: string) => void run.messages.push({ origin: null, role, data, time: Date.now(), first: '' });

const CONTEXTS = new WeakMap<Snapshot, { triggerId: string; context: ReturnType<typeof contexts> }>();

// Evaluate CBS against the original snapshot plus variable writes, not script-mutated messages.
// No setvar writes; prompt-stage display tags stay literal until the resulting message is displayed.
export function cbs(run: Run, value: string): string {
  let cached = CONTEXTS.get(run.snapshot);
  if (cached?.triggerId !== run.triggerId) {
    const context = contexts({ ...run.snapshot.scope, packs: [], toggles: { get: (key) => run.globals.get(`${TOGGLE_GLOBAL}${key}`) } }, 'prompt', null, run.triggerId, null);
    CONTEXTS.set(run.snapshot, (cached = { triggerId: run.triggerId, context }));
  }
  const { context } = cached;
  run.ranAway = false;
  try {
    return unescapeCbs(evaluate(value, context({ seed: crypto.randomUUID() }, new Map([...run.variables, ...run.written]))));
  } catch (error) {
    run.ranAway = error instanceof Runaway;
    throw error;
  }
}
