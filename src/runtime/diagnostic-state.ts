import type { Chat } from '../model/chat';
import { live } from '../model/library';
import { toolId } from '../model/tool';
import { chatModel } from './assignment';
import { limitsOf, packsOf } from './chat-context';
import type { MemoryFailure } from './memory';
import { memoryView } from './memory-view';
import { chatPrompt } from './prompts';
import type { Session } from './session';
import { forecastSend } from './turn-context';

// The operator reads this unencrypted, and the privacy policy (app/common/legal) promises what it holds: numbers,
// switches and the words known() is given. Known is branded so a text cannot reach a report by accident: known() takes
// only a closed list's word, a model's id, or a plugin's or module's name (ruled, design §6.13). Never the name or the
// text of a character, chat, persona, prompt, block or lore entry.
type Known = string & { readonly closed: unique symbol };
const known = (word: string) => word as Known;
export type Facts = { [key: string]: number | boolean | null | Known | Facts | Facts[] };

// Where the user was before opening the report; its id only picks what to read and is never reported.
export type Place = { kind: string; id: string | null };

type Reader = Pick<Session, 'store' | 'read' | 'scriptTurns' | 'tokens' | 'memory'>;

const STATE_MS = 10_000;
const LISTED = 40;

const counted = (words: string[]): Facts => {
  const counts: Facts = {};
  for (const word of words) counts[word] = ((counts[word] as number | undefined) ?? 0) + 1;
  return counts;
};

const listed = (items: Facts[]): Facts => ({ items: items.slice(0, LISTED), more: Math.max(items.length - LISTED, 0) });

function moduleFacts(store: Reader['store'], id: string): Facts {
  const module = live(store.get('module', id))?.value;
  if (!module) return { found: false };
  const tool = store.get('tool', toolId(id))?.value;
  return {
    name: known(module.name),
    regex: module.regex.length,
    triggers: module.triggers.length,
    toggles: module.toggles.length,
    takesMemory: module.takesMemory === true,
    network: module.network === true,
    tool: tool ? { name: known(tool.manifest.name), version: known(tool.manifest.version), uses: counted(tool.manifest.uses), size: tool.size } : null,
  };
}

function promptFacts(store: Reader['store'], id: string): Facts {
  const prompt = live(store.get('prompt', id))?.value;
  return prompt ? { task: known(prompt.task ?? 'conversation'), blocks: known(prompt.blocks.map((block) => ('slot' in block ? block.slot : block.kind)).join(' ')), toggles: prompt.toggles.length } : { found: false };
}

function memoryFailure(failure: MemoryFailure | undefined): Known | null {
  return failure ? known(failure.kind === 'unsaved' ? `unsaved:${failure.failure.error}` : 'reason' in failure ? `${failure.kind}:${failure.reason}` : failure.kind) : null;
}

async function memoryFacts(session: Reader, id: string): Promise<Facts> {
  const view = await memoryView(session, id);
  const { running, failed, chapterFailed, indexing, indexFailed } = session.memory.snapshot();
  const work = { running: running.has(id), failed: memoryFailure(failed.get(id)), chapterFailed: memoryFailure(chapterFailed.get(id)), indexing: indexing.has(id), indexFailed: memoryFailure(indexFailed.get(id)) };
  if (!view) return { read: false, ...work };
  const { memory, setup, slot, records, stale, tokens, crowded } = view;
  return {
    on: setup.on,
    own: setup.own,
    budget: setup.budget,
    window: setup.window,
    batch: setup.batch,
    slot,
    crowded,
    records: memory.records.length,
    chapters: memory.chapters.length,
    facts: memory.state.length,
    threads: memory.threads.length,
    status: counted([...records.values()]),
    stale: counted([...stale.values()]),
    tokens,
    ...work,
  };
}

async function requestFacts(session: Reader, id: string): Promise<Facts> {
  const sending = await forecastSend(session, id, { kind: 'answer' }, undefined, 'view');
  if (!sending) return { built: false };
  if ('kind' in sending) return { refused: known(sending.kind), ...(sending.kind === 'too-long' && { tokens: sending.tokens, budget: sending.budget }) };
  const { prompt, calibration } = sending;
  const tokens: Facts = {};
  for (const { from, tokens: size } of prompt.parts) {
    const part = from.kind === 'block' ? `block:${from.slot ?? 'text'}` : from.kind;
    tokens[part] = ((tokens[part] as number | undefined) ?? 0) + size;
  }
  const { fit, estimate } = calibration;
  return {
    messages: prompt.messages.length,
    tokens,
    dropped: prompt.dropped,
    unseen: prompt.unseen,
    problems: prompt.problems.found.length + prompt.problems.omitted,
    lore: { fired: prompt.lore?.length ?? 0, silent: prompt.silent?.length ?? 0, invalidKeys: prompt.invalidKeys.length, budget: prompt.loreBudget },
    memory: prompt.memory && { tool: prompt.memory.by !== null, covered: prompt.memory.covered, missing: prompt.memory.missing, slot: prompt.memory.slot },
    fit: { source: known(fit.source), bound: fit.bound && known(fit.bound), multiplier: fit.multiplier, allowance: fit.allowance, inputLimit: fit.inputLimit, evidence: estimate.evidence, cold: estimate.cold },
  };
}

function modelFacts(store: Reader['store'], chat: Chat): Facts {
  const route = chatModel(store, chat, 'main');
  if ('kind' in route) return { missing: known(route.kind) };
  const { context, reply } = limitsOf(store, chat);
  return { id: known(route.model.id), connection: known(route.connection.value.type), hardContext: route.model.contextLength, context, reply };
}

async function chatFacts(session: Reader, id: string): Promise<Facts> {
  const { store } = session;
  const stored = live(store.get('chat', id));
  if (!stored) return { found: false };
  const chat = stored.value;
  const lease = store.retainChat(id);
  try {
    const failure = await lease.ready;
    if (failure) return { opened: known(failure.error) };
    const prompt = chatPrompt(store, chat);
    return {
      messages: session.read.chat(id).snapshot()?.messages.length ?? null,
      character: chat.character !== null,
      model: modelFacts(store, chat),
      prompt: prompt.kind === 'prompt' ? promptFacts(store, prompt.prompt.id) : { missing: known(prompt.kind) },
      modules: listed(packsOf(store, chat).flatMap(({ id: pack, module }) => (module ? [moduleFacts(store, pack)] : []))),
      memory: await memoryFacts(session, id),
      request: await requestFacts(session, id),
    };
  } finally {
    lease.release();
  }
}

function placeFacts(session: Reader, { kind, id }: Place): Facts | Promise<Facts> | null {
  if (id === null) return null;
  if (kind === 'chat') return chatFacts(session, id);
  if (kind === 'prompt') return promptFacts(session.store, id);
  if (kind === 'module' || kind === 'plugin' || kind === 'plugin-page') return moduleFacts(session.store, id);
  if (kind === 'connection') {
    const connection = session.store.get('connection', id)?.value;
    return connection ? { type: known(connection.type), models: connection.starred.length } : { found: false };
  }
  return null;
}

// A chat that cannot be read is what a report is often sent about, so a failure here is reported, never thrown. Its
// name alone: an error's message can quote what it failed on.
export async function stateFacts(session: Reader, place: Place | null): Promise<Facts> {
  const { store } = session;
  const account: Facts = {
    characters: store.list('character').length,
    chats: store.list('chat').length,
    prompts: store.list('prompt').length,
    personas: store.list('persona').length,
    modules: store.list('module').length,
    connections: counted(store.list('connection').map(({ value }) => value.type)),
  };
  if (!place) return { place: null, account };
  const timeout = new Promise<Facts>((resolve) => setTimeout(() => resolve({ timedOut: STATE_MS }), STATE_MS));
  const facts = await Promise.race([Promise.resolve().then(() => placeFacts(session, place)), timeout]).catch((error: unknown) => ({ failed: known(error instanceof Error ? error.name : 'unknown') }));
  return { place: known(place.kind), account, facts };
}
