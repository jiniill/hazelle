import { useEffect, useRef, useState } from 'react';

// Smooth provider/display bursts over the mean interarrival wait, intentionally lagging by about one burst.
const FIRST_GAP = 100;
const MIN_GAP = 16;
const MAX_GAP = 1000;

// shown and total in characters; at: the last arrival, frame: the last frame, both in ms; rate: characters a ms.
export type Pace = { shown: number; total: number; rate: number; gap: number; at: number; frame: number };

export const startPace = (total: number, now: number): Pace => ({ shown: total, total, rate: 0, gap: FIRST_GAP, at: now, frame: now });

export function pace(current: Pace, total: number, now: number): Pace {
  if (total !== current.total) {
    const waited = Math.min(MAX_GAP, Math.max(MIN_GAP, now - current.at));
    const gap = current.gap * 0.7 + waited * 0.3;
    const shown = Math.min(current.shown, total);
    return { shown, total, rate: (total - shown) / gap, gap, at: now, frame: now };
  }
  return { ...current, shown: Math.min(total, current.shown + current.rate * (now - current.frame)), frame: now };
}

// Start at existing live text so continuations do not retype history. Finish pacing after generation ends;
// never snap in the final burst.
export function useReveal(version: string, text: string, live: boolean): { text: string; revealing: boolean } {
  const [state, setState] = useState<{ version: string; pace: Pace } | null>(null);
  const length = useRef(text.length);
  length.current = text.length;
  const own = state?.version === version ? state : null;
  if (live && !own) setState({ version, pace: startPace(text.length, performance.now()) });
  else if (!live && own && own.pace.shown >= text.length) setState(null);
  const revealing = own !== null && own.pace.shown < text.length;

  useEffect(() => {
    if (!revealing) return;
    let frame = requestAnimationFrame(function tick(now) {
      setState((current) => current && { ...current, pace: pace(current.pace, length.current, now) });
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealing]);

  if (!own) return { text, revealing: false };
  return { text: text.slice(0, revealCut(text, Math.floor(own.pace.shown))), revealing };
}

// Never split surrogate pairs or HTML tags. A transient bare < or </ breaks picture-line detection
// and flashes a folded image at full height.
export function revealCut(text: string, cut: number): number {
  if (cut >= text.length) return cut;
  if (/[\uD800-\uDBFF]/.test(text[cut - 1] ?? '')) cut -= 1;
  const open = text.lastIndexOf('<', cut - 1);
  const inside = open >= 0 && /[A-Za-z/!]/.test(text[open + 1] ?? '') && !text.slice(open, cut).includes('>');
  return inside ? open : cut;
}
