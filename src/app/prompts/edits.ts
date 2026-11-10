import { TOGGLE_GLOBAL } from '../../engine/cbs/tags';
import { isWrapped, SLOTS, type AgentPlace, type Block, type PictureSettings, type PictureTags, type Prompt, type Role, type SlotKind, type TextBlock, type Toggle } from '../../model/prompt';
import { rekeyed } from '../../model/toggles';
import type { PromptPatch } from '../../runtime/library/prompts';
import type { Command } from '../common/code/cbsCommands';
import { blockSource } from './blocks';
import { renameToggle, toggleUses } from './rekey';

// authorNote: null for a sort of prompt that has none.
export type Draft = Pick<Prompt, 'name' | 'blocks' | 'toggles'> & { authorNote: string | null; variables?: [string, string][]; tags?: PictureTags; picture?: PictureSettings; protect?: string[]; place?: AgentPlace };
export const draftOf = (prompt: Prompt): Draft => ({
  name: prompt.name,
  blocks: prompt.blocks,
  toggles: prompt.toggles,
  authorNote: prompt.task === undefined ? prompt.authorNote : null,
  variables: prompt.task === undefined ? (prompt.variables ?? []) : undefined,
  tags: prompt.task === 'illustrate' ? prompt.tags : undefined,
  picture: prompt.task === 'illustrate' ? prompt.picture : undefined,
  protect: prompt.task === 'translate' || prompt.task === 'agent' ? prompt.protect : undefined,
  place: prompt.task === 'agent' ? prompt.place : undefined,
});

export type NewBlock = { text: Role } | { slot: SlotKind };

const RECENT_COUNT = 4;
export const RECENT_MAX = 20;

export function newBlock(kind: NewBlock): Block {
  const named = { id: crypto.randomUUID(), name: null };
  if ('text' in kind) return { ...named, kind: 'text', role: kind.text, text: '', mark: null };
  const { slot } = kind;
  if (slot === 'chat') return { ...named, kind: 'slot', slot, range: { from: 0, to: null } };
  if (!isWrapped(slot)) return { ...named, kind: 'slot', slot };
  if (slot === 'recent') return { ...named, kind: 'slot', slot, role: SLOTS.recent.role, wrapper: null, count: RECENT_COUNT };
  return { ...named, kind: 'slot', slot, role: SLOTS[slot].role, wrapper: null };
}

export const placedOnce = (blocks: readonly Block[], slot: SlotKind): Block | undefined =>
  SLOTS[slot].repeats ? undefined : blocks.find((each) => each.kind === 'slot' && each.slot === slot);

// A mark is on one text at most, so marking a text takes it off the one that had it (taken).
export function withMark(blocks: readonly Block[], id: string, mark: TextBlock['mark']): { blocks: Block[]; taken: string | null } {
  let taken: string | null = null;
  const next = blocks.map((block) => {
    if (block.kind !== 'text') return block;
    if (block.id === id) return { ...block, mark };
    if (mark !== null && block.mark === mark) {
      taken = block.id;
      return { ...block, mark: null };
    }
    return block;
  });
  return { blocks: next, taken };
}

function rewrite(draft: Draft, change: (text: string) => string): PromptPatch {
  const blocks = draft.blocks.map((block) => {
    if (block.kind === 'text') return { ...block, text: change(block.text) };
    if ('wrapper' in block && block.wrapper !== null) return { ...block, wrapper: change(block.wrapper) };
    return block;
  });
  return draft.authorNote === null ? { blocks } : { blocks, authorNote: change(draft.authorNote) };
}

export const countUses = (draft: Draft, key: string) =>
  [...draft.blocks.map(blockSource), draft.authorNote ?? ''].reduce((count, text) => count + toggleUses(text).filter((use) => use.key === key).length, 0);

// Changing a key rewrites its conditions; changing only the label never touches them.
export function rekey(draft: Draft, from: string, to: string): PromptPatch {
  return { ...rewrite(draft, (text) => renameToggle(text, from, to)), toggles: rekeyed(draft.toggles, from, to) };
}

// Selected text becomes the first branch, not replaced by it.
// select: the placeholder to type over next, the first branch's or, after a selection, the second's.
export type Snippet = { text: string; select: [number, number] };

export function conditionSnippet(toggle: Toggle, selected: string): Snippet {
  // A condition is true only for '1' or 'true' (cbs/tags truthy), so a typed value is put in as it is instead.
  if (toggle.kind === 'text') {
    const text = `${selected}{{getglobalvar::${TOGGLE_GLOBAL}${toggle.key}}}`;
    return { text, select: [text.length, text.length] };
  }
  const branches =
    toggle.kind === 'check'
      ? [
          { open: `{{#when::toggle::${toggle.key}}}`, body: '켰을 때 내용', close: '' },
          { open: '{{:else}}', body: '껐을 때 내용', close: '{{/when}}' },
        ]
      : toggle.options.map((option, index) => ({ open: `{{#when::${toggle.key}::tis::${index}}}`, body: `${option}일 때 내용`, close: '{{/when}}' }));
  const target = selected ? 1 : 0;
  let text = '';
  let select: [number, number] | null = null;
  for (const [index, { open, body, close }] of branches.entries()) {
    const words = index === 0 && selected ? selected : body;
    text += open;
    if (index === target) select = [text.length, text.length + words.length];
    text += words + close;
  }
  return { text, select: select ?? [text.length, text.length] };
}

export function commandSnippet({ form }: Command): Snippet {
  const placeholder = /[가-힣]+(?: [가-힣]+)*/.exec(form);
  return { text: form, select: placeholder ? [placeholder.index, placeholder.index + placeholder[0].length] : [form.length, form.length] };
}
