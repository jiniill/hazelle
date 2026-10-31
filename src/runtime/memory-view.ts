import type { GapCause } from '../contracts/auto-diagnosis';
import { memoryBudget, rawParts, speakersOf, type ChatRead, type RecordStatus, type Staleness, type Standing } from '../engine/memory';
import type { Assembled } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import type { Chat } from '../model/chat';
import type { Memory } from '../model/memory';
import { asSent, promptBudget, scopeOf } from './chat-context';
import { chatMemory, memorySetup, sourcesOf, type MemorySetup } from './memory-read';
import type { Remembering } from './memory';
import type { Session } from './session';
import { wouldSend } from './turn-context';

// asker: background memory's lane or the memory panel's (turn-context wouldSend).
export type ChatSent = { chat: Chat; scope: ChatScope; read: ChatRead; tokens: number[]; standing: Standing | null };

export async function chatSent(session: Pick<Session, 'store' | 'read'>, id: string, asker: 'memory' | 'view', memory: Memory | null): Promise<ChatSent | { kind: 'tokenizer' } | null> {
  if (!(await session.store.projections.evaluate(id))) return null;
  const stored = session.store.get('chat', id);
  const model = session.read.chat(id).snapshot();
  if (!stored || !model) return null;
  const messages = asSent(session.store, stored.value, model.messages);
  const scope = scopeOf(session, id, stored.value, messages);
  const shown = sourcesOf(messages);
  const budget = memoryBudget(memorySetup(session.store, stored.value).budget, promptBudget(session.store, stored.value));
  const texts = await session.store.evaluation.read({ asker, chat: id }, scope, memory && { memory, shown, budget });
  if ('kind' in texts) return texts;
  return { chat: stored.value, scope, read: { shown, roles: messages.map(({ role }) => role), speakers: speakersOf(scope), texts: texts.texts }, tokens: texts.tokens, standing: texts.standing };
}

// slot reports actual prompt reachability, false for unsendable chats. Edited/pinned stale records remain sent.
// Token budgets are request-clamped; raw counts split waiting text from the recent window.
export type MemoryView = {
  memory: Memory;
  setup: MemorySetup;
  slot: boolean;
  records: ReadonlyMap<string, RecordStatus>;
  stale: ReadonlyMap<string, Staleness>;
  tokens: { used: number; budget: number; state: number; stateLimit: number; waiting: number; recent: number };
  crowded: boolean;
};

export async function memoryView(session: Pick<Session, 'store' | 'read' | 'scriptTurns' | 'tokens'>, chat: string): Promise<MemoryView | null> {
  const memory = chatMemory(session.store, chat);
  const sent = await chatSent(session, chat, 'view', memory);
  if (!sent || 'kind' in sent) return null;
  const setup = memorySetup(session.store, sent.chat);
  const held = sent.standing!;
  const { waiting, recent } = rawParts(sent.tokens, held.covered, setup.window);
  return {
    memory,
    setup,
    slot: (await wouldSend(session, chat, { kind: 'answer' }, undefined, 'view'))?.prompt.memory?.slot ?? false,
    records: held.status,
    stale: held.stale,
    tokens: { ...held.tokens, waiting, recent },
    crowded: held.crowded,
  };
}

export const leaving = (prompt: Assembled): number => (prompt.memory?.missing ?? 0) + prompt.dropped;

// Every reason that holds now. The first names the warning, so what ends by itself comes before what waits for the user.
export function leavingCauses({ memory, dropped }: Pick<Assembled, 'memory' | 'dropped'>, chat: string, { running, failed, chapterFailed }: Pick<Remembering, 'running' | 'failed' | 'chapterFailed'>): GapCause[] {
  const missing = memory?.missing ?? 0;
  const records = memory?.by === null ? memory.records : null;
  const causes: GapCause[] = [];
  if (running.has(chat)) causes.push('working');
  if (failed.has(chat) || chapterFailed.has(chat)) causes.push('failed');
  // Before a plugin's first answer on this page the forecast has none of its text, so it cannot say what will be sent.
  if (memory?.by != null && memory.covered === 0 && dropped > 0) causes.push('tool');
  if (!memory && dropped > 0) causes.push('off');
  if (memory && !memory.slot && missing > 0) causes.push('no-slot');
  if (missing > 0 && memory?.slot && records) {
    if (records.stale > 0) causes.push('stale');
    if (records.over > 0) causes.push('over');
    if (records.forgotten > 0) causes.push('forgotten');
  }
  if (memory && memory.by === null && dropped > 0) causes.push('no-room');
  return causes.length ? causes : ['unknown'];
}
