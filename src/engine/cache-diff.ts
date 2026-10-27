import type { CacheDiff } from '../model/cache';

const CELLS = 250_000;

// Diff whole numbers/words, but individual Han/kana characters; spacing-free text would otherwise be one huge token.
const units = (text: string) => text.match(/\p{N}+|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])\p{L})+|\s+|[^]/gsu) ?? [];
const size = (text: string) => Array.from(text).length;

type Item = { same: string } | { before: string; after: string };

// diff-match-patch's semantic cleanup: an unchanged stretch no longer than the changes on both sides of it joins them.
function fold(items: Item[]) {
  for (let at = 1; at < items.length - 1; at++) {
    const [left, middle, right] = [items[at - 1]!, items[at]!, items[at + 1]!];
    if (!('same' in middle) || 'same' in left || 'same' in right) continue;
    const length = size(middle.same);
    if (length > Math.max(size(left.before), size(left.after)) || length > Math.max(size(right.before), size(right.after))) continue;
    items.splice(at - 1, 3, { before: left.before + middle.same + right.before, after: left.after + middle.same + right.after });
    at = Math.max(at - 3, 0);
  }
}

export function cacheDiff(before: string, after: string): CacheDiff {
  if (before === after) return { runs: before ? [{ kind: 'same', text: before }] : [], coarse: false };
  const a = units(before);
  const b = units(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - tail - 1] === b[b.length - tail - 1]) tail++;
  const left = a.slice(head, a.length - tail);
  const right = b.slice(head, b.length - tail);
  const items: Item[] = [];
  const push = (kind: CacheDiff['runs'][number]['kind'], text: string) => {
    if (!text) return;
    const last = items.at(-1);
    if (kind === 'same') {
      if (last && 'same' in last) last.same += text;
      else items.push({ same: text });
      return;
    }
    if (!last || 'same' in last) items.push({ before: '', after: '' });
    (items.at(-1) as Extract<Item, { before: string }>)[kind] += text;
  };
  const coarse = left.length > 0 && right.length > 0 && (left.length + 1) * (right.length + 1) > CELLS;
  if (coarse || !left.length || !right.length) {
    push('before', left.join(''));
    push('after', right.join(''));
  } else {
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) table[i * width + j] = left[i] === right[j] ? 1 + table[(i + 1) * width + j + 1]! : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { push('same', left[i++]!); j++; }
      else if (i < left.length && (j === right.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) push('before', left[i++]!);
      else push('after', right[j++]!);
    }
    fold(items);
  }
  const runs: CacheDiff['runs'] = [];
  const add = (kind: CacheDiff['runs'][number]['kind'], text: string) => {
    if (text) runs.push({ kind, text });
  };
  add('same', a.slice(0, head).join(''));
  for (const item of items) {
    if ('same' in item) add('same', item.same);
    else {
      add('before', item.before);
      add('after', item.after);
    }
  }
  add('same', a.slice(a.length - tail).join(''));
  return { runs, coarse };
}
