import { isToggle, type Block, type ChatRange, type ChatSlot, type RecentSlot, type Role, type TextBlock, type Toggle, type ToggleLine, type ToggleMark, type UnreadLine, type WrappedSlot } from '../../model/prompt';
import type { PromptPatch } from '../../runtime/prompts';
import { blockTitle, MARKS } from './blocks';
import { moved } from '../../model/fields';
import { keyInUse, type LineAt, type LineMove, type ShownLine } from '../../model/toggles';
import { SLOT } from '../common/prompt-words';
import { lineTitle } from '../common/toggleWords';
import { placedOnce, rekey, withMark, type Draft } from './edits';

// A toast's 되돌리기 undoes a step out of turn, so what a step puts back may no longer fit: the slot it held is taken, or
// its key is another toggle's.
export type Refused = { refused: string };

// Both apply to the draft as it is then and change only what the edit changed, so text typed in between survives either
// way. Typing is not a step: a text field keeps the browser's own undo.
export type Step = {
  label: string;
  block: string | null;
  undo: (draft: Draft) => PromptPatch | Refused;
  redo: (draft: Draft) => PromptPatch | Refused;
};

export type History = { done: readonly Step[]; undone: readonly Step[] };
export const NO_HISTORY: History = { done: [], undone: [] };

// A step refused changes nothing and leaves the history for good, so the steps under it can still be reached.
export type Turned = { step: Step; history: History } & ({ patch: PromptPatch } | Refused);

const turned = (step: Step, change: PromptPatch | Refused, applied: History, refused: History): Turned =>
  'refused' in change ? { step, history: refused, ...change } : { step, history: applied, patch: change };

export const doing = (history: History, draft: Draft, step: Step): Turned => turned(step, step.redo(draft), { done: [...history.done, step], undone: [] }, history);

// The last step done, or the one a toast's 되돌리기 names; null when it is not there to undo.
export function undoing(history: History, draft: Draft, step = history.done.at(-1)): Turned | null {
  if (!step || !history.done.includes(step)) return null;
  const done = history.done.filter((each) => each !== step);
  return turned(step, step.undo(draft), { done, undone: [...history.undone, step] }, { done, undone: history.undone });
}

export function redoing(history: History, draft: Draft): Turned | null {
  const step = history.undone.at(-1);
  if (!step) return null;
  const undone = history.undone.slice(0, -1);
  return turned(step, step.redo(draft), { done: [...history.done, step], undone }, { done: history.done, undone });
}

// Adding is put then take to undo, removing the other way round. joining: the item as it may stand among the others
// now, under the rules adding one keeps, or why it may not.
function presence<T extends object>(item: T, at: number, same: (a: T, b: T) => boolean, joining: (items: readonly T[], item: T) => T | Refused) {
  let kept = item;
  return {
    put: (items: readonly T[]): T[] | Refused => {
      const fit = joining(items, kept);
      return 'refused' in fit ? fit : [...items.slice(0, at), fit, ...items.slice(at)];
    },
    take: (items: readonly T[]) => {
      const index = placeOf(items, kept, at, same);
      if (index === -1) return [...items];
      kept = items[index]!;
      return items.filter((_, place) => place !== index);
    },
  };
}

// at while the item still stands there, else the first like it.
const placeOf = <T>(items: readonly T[], item: T, at: number, same: (a: T, b: T) => boolean) =>
  at < items.length && same(items[at]!, item) ? at : items.findIndex((each) => same(each, item));

const sameBlock = (a: Block, b: Block) => a.id === b.id;
// A layout or unread line has no key, so it is known by what it says; two alike are interchangeable.
const said = (line: ToggleMark | UnreadLine) => ('label' in line ? line.label : 'text' in line ? line.text : '');
const sameLine = (a: ToggleLine, b: ToggleLine) => (isToggle(a) || isToggle(b) ? isToggle(a) && isToggle(b) && a.key === b.key : a.kind === b.kind && said(a) === said(b));
const lineAt = (lines: readonly ToggleLine[], line: ToggleLine, at: number) => placeOf(lines, line, at, sameLine);
// A text comes back without a mark another text has taken since: its words matter more than the mark.
const joiningBlock = (blocks: readonly Block[], block: Block): Block | Refused => {
  if (block.kind === 'slot') return placedOnce(blocks, block.slot) ? { refused: `'${SLOT[block.slot].name}' 블록은 하나만 둘 수 있어요.` } : block;
  return block.mark && blocks.some((each) => each.kind === 'text' && each.mark === block.mark) ? { ...block, mark: null } : block;
};
const keyTaken = (key: string): Refused => ({ refused: `'${key}' 키를 다른 토글이 쓰고 있어요.` });
const joiningLine = (lines: readonly ToggleLine[], line: ToggleLine): ToggleLine | Refused => (isToggle(line) && keyInUse(lines, line.key) ? keyTaken(line.key) : line);
const blocksOr = (blocks: Block[] | Refused): PromptPatch | Refused => ('refused' in blocks ? blocks : { blocks });
const togglesOr = (toggles: ToggleLine[] | Refused): PromptPatch | Refused => ('refused' in toggles ? toggles : { toggles });
const titled = (block: Block, what: string) => `'${blockTitle(block).title}' ${what}`;
const onBlock = (id: string, change: (block: Block) => Block) => (draft: Draft): PromptPatch => ({
  blocks: draft.blocks.map((each) => (each.id === id ? change(each) : each)),
});

export function addBlock(block: Block, at: number): Step {
  const { put, take } = presence(block, at, sameBlock, joiningBlock);
  return { label: titled(block, '블록 추가'), block: block.id, undo: (draft) => ({ blocks: take(draft.blocks) }), redo: (draft) => blocksOr(put(draft.blocks)) };
}

export function removeBlock(block: Block, at: number): Step {
  const { put, take } = presence(block, at, sameBlock, joiningBlock);
  return { label: titled(block, '블록 빼기'), block: block.id, undo: (draft) => blocksOr(put(draft.blocks)), redo: (draft) => ({ blocks: take(draft.blocks) }) };
}

export function moveBlock(block: Block, from: number, to: number): Step {
  const place = (index: number) => (draft: Draft): PromptPatch => {
    const now = draft.blocks.findIndex((each) => each.id === block.id);
    return now === -1 ? {} : { blocks: moved(draft.blocks, now, index) };
  };
  return { label: titled(block, '블록 옮기기'), block: block.id, undo: place(from), redo: place(to) };
}

export function setRole(block: Extract<Block, { role: Role }>, role: Role): Step {
  const to = (value: Role) => onBlock(block.id, (each) => ('role' in each ? { ...each, role: value } : each));
  return { label: titled(block, '보내는 역할 바꾸기'), block: block.id, undo: to(block.role), redo: to(role) };
}

export function setRange(block: ChatSlot, range: ChatRange): Step {
  const to = (value: ChatRange) => onBlock(block.id, (each) => (each.kind === 'slot' && each.slot === 'chat' ? { ...each, range: value } : each));
  return { label: titled(block, '들어갈 메시지 바꾸기'), block: block.id, undo: to(block.range), redo: to(range) };
}

export function setCount(block: RecentSlot, count: number): Step {
  const to = (value: number) => onBlock(block.id, (each) => (each.kind === 'slot' && each.slot === 'recent' ? { ...each, count: value } : each));
  return { label: titled(block, '메시지 수 바꾸기'), block: block.id, undo: to(block.count), redo: to(count) };
}

export function setTranslations(block: RecentSlot, on: boolean): Step {
  const to = (value: boolean) =>
    onBlock(block.id, (each) => {
      if (each.kind !== 'slot' || each.slot !== 'recent') return each;
      const next: RecentSlot = { ...each };
      if (value) delete next.translations;
      else next.translations = false;
      return next;
    });
  return { label: titled(block, on ? '번역 포함' : '번역 빼기'), block: block.id, undo: to(!on), redo: to(on) };
}

export function setCache(block: Block, on: boolean): Step {
  const to = (value: boolean) =>
    onBlock(block.id, (each) => {
      const next = { ...each };
      if (value) next.cache = true;
      else delete next.cache;
      return next;
    });
  return { label: titled(block, on ? '여기까지 캐시' : '캐시 지점 빼기'), block: block.id, undo: to(!on), redo: to(on) };
}

// Trades the 감싸는 텍스트 there for the one the step holds, so one function is both ways: each apply puts back what the one
// before took out, text typed into it since included.
export function setWrapper(block: WrappedSlot, wrapper: string | null): Step {
  let held = wrapper;
  const trade = (draft: Draft): PromptPatch => {
    const now = draft.blocks.find((each) => each.id === block.id);
    if (!now || !('wrapper' in now)) return {};
    const next = held;
    held = now.wrapper;
    return onBlock(block.id, (each) => ('wrapper' in each ? { ...each, wrapper: next } : each))(draft);
  };
  return { label: titled(block, wrapper === null ? '감싸는 텍스트 빼기' : '감싸는 텍스트 추가'), block: block.id, undo: trade, redo: trade };
}

// taken: the text withMark took the mark from, which undoing gives it back to.
export function setMark(block: TextBlock, mark: TextBlock['mark'], taken: string | null): Step {
  const was = block.mark;
  const undo = (draft: Draft): PromptPatch => ({
    blocks: draft.blocks.map((each) => (each.kind !== 'text' ? each : each.id === block.id ? { ...each, mark: was } : each.id === taken ? { ...each, mark } : each)),
  });
  return { label: titled(block, mark ? `${MARKS[mark].label} 표시` : '표시 빼기'), block: block.id, undo, redo: (draft) => ({ blocks: withMark(draft.blocks, block.id, mark).blocks }) };
}

// The lines in order, so each is put back from the first at its own place and taken from the last.
function linesPresence(lines: readonly LineAt[]) {
  const parts = lines.map(({ line, at }) => presence(line, at, sameLine, joiningLine));
  return {
    put: (draft: Draft) => togglesOr(parts.reduce<ToggleLine[] | Refused>((toggles, part) => ('refused' in toggles ? toggles : part.put(toggles)), [...draft.toggles])),
    take: (draft: Draft): PromptPatch => ({ toggles: parts.toReversed().reduce<ToggleLine[]>((toggles, part) => part.take(toggles), [...draft.toggles]) }),
  };
}

export function addLines(lines: readonly [ShownLine, ...ToggleLine[]], at: number): Step {
  const { put, take } = linesPresence(lines.map((line, index) => ({ line, at: at + index })));
  const [line] = lines;
  return { label: `${lineTitle(line)} ${isToggle(line) ? '만들기' : '추가'}`, block: null, undo: take, redo: put };
}

export function removeLines(lines: readonly [LineAt<ShownLine>, ...LineAt[]]): Step {
  const { put, take } = linesPresence(lines);
  return { label: `${lineTitle(lines[0].line)} 삭제`, block: null, undo: put, redo: take };
}

// A text toggle's default is typed in place, outside the steps, so a rename put back keeps what was typed since.
export function editLine(before: ShownLine, after: ToggleLine, at: number, what: 'label' | 'default' | 'line'): Step {
  const swap = (from: ToggleLine, to: ToggleLine) => (draft: Draft): PromptPatch => {
    const now = lineAt(draft.toggles, from, at);
    const put = (line: ToggleLine) => (what === 'label' && isToggle(line) && isToggle(to) ? { ...line, label: to.label } : to);
    return now === -1 ? {} : { toggles: draft.toggles.map((each, index) => (index === now ? put(each) : each)) };
  };
  const words = what === 'default' ? '기본값 바꾸기' : what === 'line' || before.kind === 'caption' ? '내용 바꾸기' : '이름 바꾸기';
  return { label: `${lineTitle(before)} ${words}`, block: null, undo: swap(after, before), redo: swap(before, after) };
}

// line: the run's first, a group's head with what it holds.
export function moveLines(line: ShownLine, { from, count, to }: LineMove): Step {
  const place = (was: number, index: number) => (draft: Draft): PromptPatch => {
    const now = lineAt(draft.toggles, line, was);
    return now === -1 ? {} : { toggles: moved(draft.toggles, now, index, count) };
  };
  return { label: `${lineTitle(line)} 옮기기`, block: null, undo: place(to, from), redo: place(from, to) };
}

export function renameKey(toggle: Toggle, to: string): Step {
  const renamed = (from: string, next: string) => (draft: Draft) => (keyInUse(draft.toggles, next) ? keyTaken(next) : rekey(draft, from, next));
  return { label: `'${toggle.label}' 키 바꾸기`, block: null, undo: renamed(to, toggle.key), redo: renamed(toggle.key, to) };
}
