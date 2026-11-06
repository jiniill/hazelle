import { useMemo, type RefObject } from 'react';
import type { Message } from '../../model/chat';
import { useDisplay } from '../display';
import { rowAt, viewLines, type Seek } from '../ui';
import { stepFrom, storyStops, type Direction, type Step } from './storySteps';

// Moving through the story by its messages: the step buttons, the scrubber and their shortcuts. Each move returns the
// place it reached, as the step buttons show it.
export function useStorySteps(messages: readonly Message[], scrollRef: RefObject<HTMLElement | null>, seekTo: (key: string, lands: Seek['lands']) => void, follow: () => void) {
  const { display } = useDisplay();
  // By the ids, not the array: a reply being written hands over a new one with every chunk, and the scrubber places
  // itself again whenever its keys or stops change.
  const ids = messages.map(({ id }) => id).join();
  const keys = useMemo(() => messages.map(({ id }) => id), [ids]);
  const stops = useMemo(() => storyStops(messages, display.userStops), [ids, display.userStops]);

  function reach(target: Step): string {
    if (target === 'end') {
      follow();
      return '맨 아래';
    }
    if (target === 'start') {
      if (keys.length) seekTo(keys[0]!, 'top');
      return '맨 위';
    }
    seekTo(keys[target.index]!, target.lands);
    return `#${target.index + 1} ${target.lands === 'top' ? '처음' : '끝'}`;
  }

  function step(direction: Direction) {
    const frame = scrollRef.current!;
    const lines = viewLines(frame);
    const row = rowAt(frame, direction === 'up' ? lines.top : lines.bottom);
    const index = row ? keys.indexOf(row.key) : -1;
    return reach(stepFrom(stops, keys.length - 1, row && index >= 0 ? { index, above: row.above, below: row.below } : null, direction));
  }

  return {
    keys,
    stops,
    actions: {
      step,
      toEnd: (direction: Direction) => reach(direction === 'up' ? 'start' : 'end'),
      seek: (key: string) => seekTo(key, 'top'),
    },
  };
}
