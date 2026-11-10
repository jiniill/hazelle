import { useState } from 'react';
import type { PostRow } from '../../contracts/board';
import { votePost } from '../../runtime/service/board';
import { useToast } from '../toast';

type Shown = { voted: boolean; votes: number };

// 추천 flipped before the server answers. A flip holds only over the row it was made on, so a reload's counts replace it.
export function useVotes(gate: (then: () => void) => void) {
  const toast = useToast();
  const [flips, setFlips] = useState<Map<number, Shown & { of: PostRow }>>(new Map());
  const put = (row: PostRow, shown: Shown) => setFlips((before) => new Map(before).set(row.id, { of: row, ...shown }));
  const shownOf = (row: PostRow): Shown => {
    const flip = flips.get(row.id);
    return flip?.of === row ? flip : row;
  };
  async function flip(row: PostRow, before: Shown) {
    const voted = !before.voted;
    put(row, { voted, votes: before.votes + (voted ? 1 : -1) });
    const answer = await votePost(row.id, voted);
    if (answer.ok) return put(row, { voted, votes: answer.data.votes });
    put(row, before);
    toast.failed(answer, '추천하지 못했어요.');
  }
  return (row: PostRow) => {
    const shown = shownOf(row);
    return { ...shown, onFlip: () => gate(() => void flip(row, shown)) };
  };
}
