export type Direction = 'up' | 'down';
export type Step = { index: number; lands: 'top' | 'bottom' } | 'start' | 'end';

// Within this many px of a row's edge the view is at that edge already.
const NEAR = 8;

// The rows the story's steps and its scrubber stop at: the replies, and the user's own messages too with
// 내 메시지에서도 멈추기 on. A user's line sits right above the reply that answers it, so stopping there costs a press.
export function storyStops(messages: readonly { role: 'user' | 'assistant' }[], mine: boolean): number[] {
  return messages.flatMap((message, index) => (mine || message.role !== 'user' ? [index] : []));
}

// The current row belongs to the reader even if not a stop: reach its start/end before another row.
// at locates that leaving edge; distances are relative to row top/end.
export function stepFrom(stops: readonly number[], last: number, at: { index: number; above: number; below: number } | null, direction: Direction): Step {
  if (!at) return direction === 'up' ? 'start' : 'end';
  const target = direction === 'up'
    ? at.above > NEAR ? at.index : stops.findLast((stop) => stop < at.index)
    : at.above > NEAR && at.below > NEAR ? at.index : stops.find((stop) => (at.below > NEAR ? stop >= at.index : stop > at.index));
  if (target === undefined) return direction === 'up' ? 'start' : 'end';
  // The last row's end is the story's, which only following reaches: its end leaves the room under it.
  if (direction === 'down' && target === last) return 'end';
  return { index: target, lands: direction === 'up' ? 'top' : 'bottom' };
}
