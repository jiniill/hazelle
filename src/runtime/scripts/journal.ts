import { ChangeSignal } from '../../change-signal';
import { isRecord } from '../../connectors/values';
import type { HookLog, HookTrace } from '../../engine/lua/run';
import type { Outcome } from '../../engine/script-api';
import { live, type PackOwner } from '../../model/library';
import type { ScriptInteractions } from './interactions';
import type { ObjectStore } from '../store';

export type ScriptLog = { entries: readonly HookLog[]; omitted: number };
// Page memory only; evict by both entry count and serialized characters, since a script controls its text.
export const SCRIPT_LOG_LIMITS = { entries: 100, characters: 256 * 1024 } as const;
const EMPTY_LOG: ScriptLog = { entries: [], omitted: 0 };

export class ScriptJournal {
  private readonly logs = new Map<string, { snapshot: ScriptLog; sizes: number[]; characters: number }>();
  private readonly logChanges = new Map<string, { changes: ChangeSignal; users: number }>();

  constructor(
    private readonly store: ObjectStore,
    private readonly interactions: ScriptInteractions,
    private readonly closing: AbortSignal,
  ) {}

  prune() {
    for (const chat of this.logs.keys()) {
      if (!live(this.store.get('chat', chat)) || this.store.scopeState(chat) === 'unloaded') {
        this.logs.delete(chat);
        this.logChanges.get(chat)?.changes.notify();
      }
    }
  }

  readonly log = (chat: string): ScriptLog => this.logs.get(chat)?.snapshot ?? EMPTY_LOG;

  readonly subscribeLog = (chat: string, listener: () => void) => {
    const held = this.logChanges.get(chat) ?? { changes: new ChangeSignal(), users: 0 };
    this.logChanges.set(chat, held);
    held.users++;
    const stop = held.changes.subscribe(listener);
    return () => {
      stop();
      if (--held.users === 0) this.logChanges.delete(chat);
    };
  };

  keepLog(chat: string, entries: readonly HookLog[], dropped = 0) {
    if (!entries.length || this.closing.aborted || this.store.scopeState(chat) === 'unloaded') return;
    const held = this.logs.get(chat) ?? { snapshot: EMPTY_LOG, sizes: [], characters: 0 };
    const next = [...held.snapshot.entries];
    let omitted = held.snapshot.omitted + dropped;
    for (const raw of entries) {
      let truncated = raw.truncated;
      const clip = (text: string) => { if (text.length > 1024) truncated = true; return text.slice(0, 1024); };
      const tail = <T>(items: T[]) => { if (items.length > 16) truncated = true; return items.slice(-16); };
      const entry: HookLog = { ...raw, stage: clip(raw.stage), script: clip(raw.script), logs: tail(raw.logs).map(clip), writes: tail(raw.writes).map(([name, value]) => [clip(name), clip(value)]), errors: tail(raw.errors).map((error) => 'message' in error ? { ...error, script: clip(error.script), message: clip(error.message) } : error), missing: tail(raw.missing).map(clip), truncated };
      const size = JSON.stringify(entry).length;
      next.push(entry);
      held.sizes.push(size);
      held.characters += size;
      while (next.length > SCRIPT_LOG_LIMITS.entries || held.characters > SCRIPT_LOG_LIMITS.characters) {
        next.shift();
        held.characters -= held.sizes.shift()!;
        omitted++;
      }
    }
    held.snapshot = { entries: next, omitted };
    this.logs.set(chat, held);
    this.logChanges.get(chat)?.changes.notify();
  }

  report(chat: string, result: Pick<Outcome, 'errors' | 'missing'> | unknown, from: PackOwner | null = null) {
    // Event outcomes forward the Lua trace through runEvent's spread; display batches report it directly.
    if (isRecord(result) && 'trace' in result) {
      const trace = result.trace as HookTrace;
      this.keepLog(chat, trace.entries, trace.omitted);
    }
    this.interactions.report(chat, result, from);
  }

  close() {
    this.logs.clear();
    for (const { changes } of this.logChanges.values()) { changes.notify(); changes.clear(); }
    this.logChanges.clear();
  }
}
