import { useEffect, useState } from 'react';
import type { Cost } from '../../connectors/types';
import { askEstimate } from '../../runtime/tools/plugin-writer';
import { cost } from '../common/receipt';
import { count } from '../common/typedNumber';

type Ask = Parameters<typeof askEstimate>[1];

// Earlier asks change only with a sent one, which empties the ask, so they are not watched.
export function useAskEstimate(deps: Parameters<typeof askEstimate>[0], ask: Ask | null): Cost | null {
  const [estimate, setEstimate] = useState<Cost | null>(null);
  useEffect(() => {
    if (!ask) return setEstimate(null);
    let current = true;
    const timer = setTimeout(() => void askEstimate(deps, ask).then((found) => current && setEstimate(found)), 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [deps, ask?.body, ask?.ask, ask?.model]);
  return estimate;
}

// written: the answer's length so far while it is being written, else null.
export const askHint = (written: number | null, estimate: Cost | null) => (written !== null ? `생성 중… ${count(written)}자` : estimate === null ? undefined : `예상 ${cost(estimate)}`);
