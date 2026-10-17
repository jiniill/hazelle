import { describe, expect, it } from 'vitest';
import type { Block, TextBlock, ToggleLine } from '../../model/prompt';
import type { Draft } from './edits';
import { addBlock, doing, editLine, moveLine, NO_HISTORY, removeBlock, removeLine, undoing, type History, type Step, type Turned } from './history';

const text = (id: string, words: string): TextBlock => ({ id, name: null, kind: 'text', role: 'system', text: words, mark: null });
const authorNote = (id: string): Block => ({ id, name: null, kind: 'slot', slot: 'authorNote', role: 'system', wrapper: null });
const draftOf = (blocks: Block[]): Draft => ({ name: '', blocks, toggles: [], authorNote: '' });
const after = (draft: Draft, turned: Turned | null): Draft => (turned && 'patch' in turned ? { ...draft, ...turned.patch } : draft);
const typed = (draft: Draft, id: string, words: string): Draft => ({ ...draft, blocks: draft.blocks.map((block) => (block.id === id && block.kind === 'text' ? { ...block, text: words } : block)) });

describe('the prompt editor history of toggle lines', () => {
  const rule: ToggleLine = { kind: 'divider', label: '' };
  const sims: ToggleLine = { key: 'sims', label: '시뮬레이터', kind: 'check', default: '0' };
  const note: ToggleLine = { kind: 'caption', label: '안내' };
  const lines = (toggles: ToggleLine[]): Draft => ({ name: '', blocks: [], toggles, authorNote: '' });
  const apply = (draft: Draft, change: ReturnType<Step['redo']>): Draft => ('refused' in change ? draft : { ...draft, ...change });

  it('takes out the layout line at its own place among alike ones, and puts it back there', () => {
    const removal = removeLine(rule, 2);
    const removed = apply(lines([rule, sims, rule, note]), removal.redo(lines([rule, sims, rule, note])));
    expect(removed.toggles).toEqual([rule, sims, note]);
    expect(apply(removed, removal.undo(removed)).toggles).toEqual([rule, sims, rule, note]);
  });

  it('finds a layout line that moved since by what it says, to rename it back or move it back', () => {
    const renamed: ToggleLine = { kind: 'caption', label: '새 안내' };
    const edit = editLine(note, renamed, 1, 'label');
    let draft = apply(lines([sims, note]), edit.redo(lines([sims, note])));
    draft = lines([rule, ...draft.toggles]);
    expect(apply(draft, edit.undo(draft)).toggles).toEqual([rule, sims, note]);

    const move = moveLine(rule, 0, 2);
    draft = apply(lines([rule, sims, note]), move.redo(lines([rule, sims, note])));
    expect(draft.toggles).toEqual([sims, note, rule]);
    expect(apply(draft, move.undo(draft)).toggles).toEqual([rule, sims, note]);
  });
});

describe('the prompt editor history', () => {
  it('undoes a step on the draft as it is then, keeping what was typed since, and redoes it with its own typing', () => {
    const step = addBlock(text('b', ''), 1);
    let draft = after(draftOf([text('a', '가')]), doing(NO_HISTORY, draftOf([text('a', '가')]), step));
    draft = typed(typed(draft, 'a', '가나다'), 'b', '새 글');

    draft = { ...draft, ...step.undo(draft) };
    expect(draft.blocks).toEqual([text('a', '가나다')]);
    draft = { ...draft, ...step.redo(draft) };
    expect(draft.blocks).toEqual([text('a', '가나다'), text('b', '새 글')]);
  });

  it('undoes the step a toast names and leaves the others on the stack', () => {
    const first = removeBlock(text('a', ''), 0);
    const second = removeBlock(text('b', ''), 0);
    const history: History = { done: [first, second], undone: [] };

    const undone = undoing(history, draftOf([]), first);
    expect(undone?.history).toEqual({ done: [second], undone: [first] });
    expect(undoing(undone!.history, draftOf([]), first)).toBeNull();
  });

  it('refuses to put back a slot placed once while another stands, changing nothing and dropping the step', () => {
    const removal = removeBlock(authorNote('old'), 0);
    const addition = addBlock(authorNote('new'), 0);
    const draft = draftOf([authorNote('new')]);
    const history: History = { done: [removal, addition], undone: [] };

    const refused = undoing(history, draft, removal);
    expect(refused).toMatchObject({ refused: expect.stringContaining('하나만 둘 수 있어요'), history: { done: [addition], undone: [] } });
    expect(after(draft, refused)).toBe(draft);
  });
});
