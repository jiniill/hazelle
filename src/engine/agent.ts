import type { AgentPrompt, AgentStage, Block } from '../model/prompt';

// Built-ins are opt-in, never auto-attached (user, 2026-10-21).
// Scene notes follow MARP baseline; polish follows the user's own polishers.
const SCENE = [
  'You plan the next reply of an ongoing story for another model, which writes it. You do not write the reply.',
  '',
  'From the setting, the messages so far and the newest message, write short notes for that reply:',
  '- what the newest message says or does, and what the scene needs next;',
  '- the facts from the characters, the world and the story so far that bear on it, quoting the source where its wording matters;',
  '- how each character present would act and speak now, true to who they are.',
  '',
  "Leave the user's character to the user: never decide what they say, do, think or feel. Do not judge the content. Write in the language of the story. Answer with the notes only, in at most about 200 words.",
].join('\n');

const POLISH = [
  'You edit one reply of an ongoing story so that it reads cleanly.',
  '',
  '- Cut repetition, filler and overwrought description.',
  '- Keep every event, line of dialogue, fact and name, in the same order.',
  '- Keep its language, point of view, tense and markup exactly as written.',
  '- Add nothing new.',
  '',
  'Answer with the edited reply only, with nothing before or after it.',
].join('\n');

export type AgentStart = 'scene' | 'polish' | AgentStage;

const named = (name: string | null = null) => ({ id: crypto.randomUUID(), name });

function preBlocks(instruction: string): Block[] {
  return [
    { ...named('에이전트 지시'), kind: 'text', role: 'system', text: instruction, mark: null },
    { ...named(), kind: 'slot', slot: 'description', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'persona', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'lorebook' },
    { ...named(), kind: 'slot', slot: 'recent', role: 'system', count: 6, translations: false, wrapper: 'The messages before the newest, oldest first.\n---\n{{slot}}' },
    { ...named(), kind: 'slot', slot: 'source', role: 'user', wrapper: 'The newest message, which the next reply answers:\n\n{{slot}}' },
  ];
}

// A polisher reads the reply alone, as the user's own do: context costs every turn and changes little of a trim.
function postBlocks(instruction: string): Block[] {
  return [
    { ...named('에이전트 지시'), kind: 'text', role: 'system', text: instruction, mark: null },
    { ...named(), kind: 'slot', slot: 'source', role: 'user', wrapper: null },
  ];
}

// An empty one starts with the slots of its stage and no instruction.
export function agentPrompt(start: AgentStart, name: string): AgentPrompt {
  const stage: AgentStage = start === 'scene' || start === 'pre' ? 'pre' : 'post';
  const instruction = start === 'scene' ? SCENE : start === 'polish' ? POLISH : '';
  return { task: 'agent', name, stage, toggles: [], blocks: stage === 'pre' ? preBlocks(instruction) : postBlocks(instruction) };
}

export const builtInAgent = (stage: AgentStage) => agentPrompt(stage === 'pre' ? 'scene' : 'polish', '');

export const keepsMemory = (prompt: Pick<AgentPrompt, 'blocks'>) => prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'agentMemory');

// The sheet below and parseAgentAnswer are one contract: the block asked for here is the one cut there.
export function memorySheet(memory: string): string {
  return [
    'You keep a memory of your own across this chat, which only you read.',
    ...(memory.trim() ? ['It stands now as:', '---', memory.trim(), '---'] : ['It is empty so far.']),
    'After your answer, write your whole memory as it should stand after this turn inside <memory></memory>, in full: keep what still matters, add what is new, drop what no longer does.',
  ].join('\n');
}

const MEMORY = /<memory>([\s\S]*?)(?:<\/memory>|$)/giu;

// memory: null when the answer holds no block, which leaves the agent's memory as it was. The last block stands.
export function parseAgentAnswer(text: string): { text: string; memory: string | null } {
  const blocks = [...text.matchAll(MEMORY)];
  return { text: text.replace(MEMORY, '').trim(), memory: blocks.length ? blocks.at(-1)![1]!.trim() : null };
}

export const agentNotes = (notes: readonly { name: string; note: string }[]) =>
  notes
    .filter(({ note }) => note.trim())
    .map(({ name, note }) => `[${name}]\n${note.trim()}`)
    .join('\n\n');
