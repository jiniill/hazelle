import { count, list, text } from '../../connectors/values';
import { isRecord } from '../../record';
import type { Block, ConversationPrompt, Role, TextBlock } from '../../model/prompt';
import { isProse, separatorOf } from '../cbs/evaluate';
import { handlerFor, normalize } from '../cbs/tags';
import { add, finite, record, sillyTavernRegex, type Json, type Tally } from './convert';
import type { PresetCounted } from './preset';
import type { RegexScript } from './types';

// SillyTavern's chat-completion preset: its prompts by identifier, in the order of its global prompt_order, the one
// SillyTavern reads for every character.
export const isSillyTavernPreset = (json: Json) => Array.isArray(json.prompts) && Array.isArray(json.prompt_order);
const GLOBAL_ORDER = 100001;

// Its markers that a slot here holds. The description slot sends the personality, scenario and example dialogue with the
// description, and lore SillyTavern puts before or after the character goes there too (design §5 row 33), so each of
// these places its slot at its first marker.
const SLOT_MARKERS = new Map<unknown, 'description' | 'lorebook' | 'persona'>([
  ['charDescription', 'description'],
  ['charPersonality', 'description'],
  ['scenario', 'description'],
  ['dialogueExamples', 'description'],
  ['worldInfoBefore', 'lorebook'],
  ['worldInfoAfter', 'lorebook'],
  ['personaDescription', 'persona'],
]);
// The prompts SillyTavern sends though they are its own (system_prompt); the card's system prompt and post-history
// instructions replace the two marked ones, with {{original}} for their text, unless the prompt forbids it.
const OWN = new Map<unknown, TextBlock['mark']>([
  ['main', 'main'],
  ['jailbreak', 'globalNote'],
  ['nsfw', null],
  ['enhanceDefinitions', null],
]);
const ROLES = new Set<unknown>(['system', 'user', 'assistant']);
// SillyTavern's defaults for how it assembles the prompt, which this app has no setting for; one changed is counted.
const ASSEMBLY: Json = { new_example_chat_prompt: '[Example Chat]', wi_format: '{0}', scenario_format: '{{scenario}}', personality_format: '{{personality}}', send_if_empty: '', assistant_prefill: '', squash_system_messages: false };

type Injected = { block: TextBlock; depth: number; order: number };
// At one depth SillyTavern sends the lower injection_order first, and within one order assistant, user, then system.
const INJECTED_ROLES: Role[] = ['assistant', 'user', 'system'];

// null when it has no global prompt_order.
export function sillyTavernPreset(preset: Json, name: string): { prompt: ConversationPrompt; regex: RegexScript[]; counts: Tally<PresetCounted> } | null {
  const order = list(preset.prompt_order).find((entry) => isRecord(entry) && entry.character_id === GLOBAL_ORDER);
  if (!isRecord(order)) return null;
  const counts: Tally<PresetCounted> = new Map();
  const prompts = new Map(list(preset.prompts).filter(isRecord).map((prompt) => [prompt.identifier, prompt]));
  const listed = new Set<unknown>();
  const blocks: Block[] = [];
  const injected: Injected[] = [];
  const placed = new Set<string>();
  let chatAt: number | null = null;
  for (const entry of list(order.order).filter(isRecord)) {
    // SillyTavern skips a line naming no prompt.
    const prompt = prompts.get(entry.identifier);
    if (!prompt) continue;
    listed.add(entry.identifier);
    if (entry.enabled !== true || !triggered(prompt)) {
      add(counts, 'off-item');
      continue;
    }
    const named = { id: crypto.randomUUID(), name: text(prompt.name) || null };
    if (prompt.marker === true) {
      const slot = SLOT_MARKERS.get(prompt.identifier);
      if (prompt.identifier === 'chatHistory') chatAt = blocks.length;
      else if (!slot) add(counts, 'unread-item');
      else if (!placed.has(slot)) {
        placed.add(slot);
        blocks.push(slot === 'lorebook' ? { ...named, kind: 'slot', slot } : { ...named, kind: 'slot', slot, role: 'system', wrapper: null });
      }
      continue;
    }
    // A prompt of SillyTavern's own that is none of these it does not send.
    if (prompt.system_prompt === true && !OWN.has(prompt.identifier)) {
      add(counts, 'unread-item');
      continue;
    }
    const mark = prompt.forbid_overrides === true ? null : (OWN.get(prompt.identifier) ?? null);
    const said = text(prompt.content);
    // An empty prompt sends nothing, unless the card's text replaces it.
    if (!said.trim() && mark === null) continue;
    const block: TextBlock = { ...named, kind: 'text', role: ROLES.has(prompt.role) ? (prompt.role as Role) : 'system', text: said, mark };
    if (prompt.injection_position !== 1) {
      blocks.push(block);
      continue;
    }
    // In the chat, at its depth, which SillyTavern's editor always writes.
    const depth = count(prompt.injection_depth);
    if (depth === null) add(counts, 'unread-item');
    else injected.push({ block, depth, order: finite(prompt.injection_order) ?? 100 });
  }
  add(counts, 'off-item', [...prompts.keys()].filter((identifier) => !listed.has(identifier)).length);
  if (chatAt === null) add(counts, 'off-item', injected.length);
  else blocks.splice(chatAt, 0, ...chatPieces(text(preset.new_chat_prompt), injected));

  add(counts, 'macro', unrun(blocks.flatMap((block) => (block.kind === 'text' ? [block.text] : []))));
  const regex = sillyTavernRegex(list(record(preset.extensions).regex_scripts), counts);
  const changed = Object.keys(ASSEMBLY).filter((field) => field in preset && preset[field] !== ASSEMBLY[field]).length;
  // Names go into the messages from 1 up; 0 and below send none in a chat with one character.
  add(counts, 'prompt-settings', changed + (typeof preset.names_behavior === 'number' && preset.names_behavior > 0 ? 1 : 0));
  // Model and generation settings belong to each model's settings; every preset has them.
  add(counts, 'settings');
  return { prompt: { name, blocks, toggles: [], authorNote: '', models: {}, imported: 'sillytavern-preset' }, regex, counts };
}

// A prompt limited to other kinds of generation (continue, swipe, impersonate…) is not sent with a reply.
const triggered = (prompt: Json) => {
  const triggers = list(prompt.injection_trigger);
  return triggers.length === 0 || triggers.includes('normal');
};

// The chat history after SillyTavern's new-chat line, cut where in-chat prompts go: one at depth d goes before the last d
// messages, so the chat runs to -d, the prompts follow and the chat goes on from -d.
function chatPieces(opening: string, injected: Injected[]): Block[] {
  const pieces: Block[] = opening.trim() ? [{ id: crypto.randomUUID(), name: null, kind: 'text', role: 'system', text: opening, mark: null }] : [];
  const chat = (from: number, to: number | null): Block => ({ id: crypto.randomUUID(), name: null, kind: 'slot', slot: 'chat', range: { from, to } });
  const depths = [...new Set(injected.map(({ depth }) => depth))].sort((a, b) => b - a);
  let from = 0;
  for (const depth of depths) {
    pieces.push(chat(from, depth === 0 ? null : -depth));
    from = -depth;
    const here = injected.filter((each) => each.depth === depth);
    pieces.push(...here.sort((a, b) => a.order - b.order || INJECTED_ROLES.indexOf(a.block.role) - INJECTED_ROLES.indexOf(b.block.role)).map(({ block }) => block));
  }
  if (depths.at(-1) !== 0) pieces.push(chat(from, null));
  return pieces;
}

// setvar and its kin write only in a chat message here (design §5 row 18), so in a prompt block they do nothing.
const WRITES = new Set(['setvar', 'addvar', 'setdefaultvar']);

// The macros this app cannot run as SillyTavern does: a name it does not know, too few arguments, or a write. They stay
// as written. Comments, blocks and their closers are CBS's own.
function unrun(texts: string[]): number {
  let found = 0;
  for (const value of texts) {
    for (const match of value.matchAll(/\{\{([^{}]*)\}\}/g)) {
      const content = match[1]!;
      if (/^\s*[/#:]/.test(content) || isProse(content)) continue;
      const separator = separatorOf(content);
      const [name, ...args] = separator === null ? [content] : content.split(separator);
      const handler = handlerFor(name!);
      if (!handler || args.length < handler.min || WRITES.has(normalize(name!))) found++;
    }
  }
  return found;
}
