import { useLayoutEffect, useRef, useState } from 'react';
import { tokenPx } from './tokenPx';

// Whether the room an element is given is narrower than a width token, the token read on the element so a frame's
// own value counts. Unknown until the first measure, which runs before the first paint.
export function useNarrowerThan<T extends HTMLElement>(token: string) {
  const room = useRef<T>(null);
  const [narrower, setNarrower] = useState<boolean>();
  useLayoutEffect(() => {
    const element = room.current!;
    const measure = () => setNarrower(element.clientWidth < tokenPx(token, element));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, [token]);
  return [room, narrower] as const;
}
