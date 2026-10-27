import type { Block, ChatRange, ChatSlot } from '../../model/prompt';
import { withParticle } from '../common/particles';

// Where a range starts and ends in a chat of `length` messages, as a slice reads it: negative counts from the end.
function span({ from, to }: ChatRange, length: number): [number, number] {
  const at = (index: number) => Math.min(length, Math.max(0, index < 0 ? length + index : index));
  return [at(from), to === null ? length : at(to)];
}

// Compare ranges on a chat long enough to separate start/end-relative bounds, so gaps/overlaps remain valid
// for every longer chat. Null means every message is sent once.
export function chatWarning(blocks: readonly Block[]): string | null {
  const ranges = blocks.filter((block): block is ChatSlot => block.kind === 'slot' && block.slot === 'chat').map((block) => block.range);
  if (ranges.length === 0) return `'채팅' 블록이 없어서 메시지가 하나도 들어가지 않아요.`;
  const reach = Math.max(...ranges.flatMap(({ from, to }) => [Math.abs(from), Math.abs(to ?? 0)]));
  const length = 2 * reach + 2;
  // Read span by span, never message by message: a range's ends are any integers, so the chat it is read on has no
  // size a list could take.
  const spans = ranges
    .map((range) => span(range, length))
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0]);
  const missed: string[] = [];
  let next = 0;
  for (const [start, end] of spans) {
    if (start < next) return `'채팅' 블록끼리 범위가 겹쳐서 같은 메시지가 두 번 들어가요.`;
    if (start > next) missed.push(describeRun(next, start - 1, length, reach));
    next = end;
  }
  if (next < length) missed.push(describeRun(next, length - 1, length, reach));
  return missed.length ? `'채팅' 블록의 범위에서 ${withParticle(missed.join(', '), '이/가')} 빠져요.` : null;
}

function describeRun(first: number, last: number, length: number, reach: number): string {
  if (first === 0) return '앞부분';
  const fromEnd = (index: number) => length - index;
  const nearEnd = first >= length - reach;
  if (last === length - 1) return !nearEnd ? '뒷부분' : first === last ? '마지막 메시지' : `마지막 ${fromEnd(first)}개`;
  if (!nearEnd) return '중간 메시지';
  return first === last ? `끝에서 ${fromEnd(first)}번째 메시지` : `끝에서 ${fromEnd(last)}~${fromEnd(first)}번째 메시지`;
}
