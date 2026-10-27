import { useLayoutEffect, useRef, useState } from 'react';
import { READER_RESIZED, ROWS_RESIZED, type Seek } from '../ui';

// The view at the end stays there until it is well above, and comes back only at the very end, so scrolling into the
// band does not snap it down.
export const atEnd = (distance: number, was: boolean) => distance < (was ? 48 : 1);

// Stay anchors at the answered user message, or at the new reply after assistant text.
// Continuations anchor nothing: they append to already-read text. Null until the reply appears.
export function anchorOf(messages: readonly { id: string; role: string }[], reply: string): string | null {
  const at = messages.findIndex(({ id }) => id === reply);
  if (at < 1) return null;
  return messages[at - 1]!.role === 'user' ? messages[at - 1]!.id : reply;
}

// stay pins the reply-start anchor and ignores story growth. Raise the pill only after a view of unread text,
// or immediately on reader scroll, until explicit follow.
export function useFollow(count: number, streaming: boolean, anchor: string | null, stay: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const held = useRef(false);
  // Where toBottom, or the composer's room, left the view. Its scroll event comes after the story may have grown again,
  // so it is not the reader leaving the bottom.
  const placed = useRef<number | null>(null);
  // A screen mounted while its reply is still being written (the chat left and come back to) treats that reply as
  // starting now, so stay holds it too.
  const seen = useRef({ count, streaming: false, anchor: null as string | null });
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);
  const [seek, setSeek] = useState<Seek | null>(null);

  const toBottom = () => {
    const element = scrollRef.current;
    if (!element || !stick.current || held.current) return;
    element.scrollTop = element.scrollHeight;
    placed.current = element.scrollTop;
  };

  useLayoutEffect(() => {
    // Before following, which would take the view down first.
    if (stay && streaming && !seen.current.streaming) held.current = true;
    // The story shows the reply's messages a render or more after it starts.
    if (stay && anchor !== null && anchor !== seen.current.anchor) {
      held.current = true;
      seekTo(anchor, 'top');
    }
    toBottom();
    const ended = seen.current.streaming && !streaming;
    if ((count > seen.current.count || ended) && !stick.current) setUnread(true);
    seen.current = { count, streaming, anchor };
  });

  // Follow streamed row resizes (ROWS_RESIZED), not reader-driven picture changes (READER_RESIZED).
  // Composer room belongs to the border box, not story: bottom follows it even during stay.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    const roomOf = () => parseFloat(getComputedStyle(content).paddingBottom);
    let room = roomOf();
    // The view stays where the reader opened or closed a picture, off the end until it is at the end again.
    const leave = () => {
      stick.current = false;
      placed.current = null;
    };
    const observer = new ResizeObserver(() => {
      const now = roomOf();
      if (now !== room && stick.current) {
        element.scrollTop += now - room;
        placed.current = element.scrollTop;
      }
      room = now;
      toBottom();
      settle(false);
    });
    observer.observe(content, { box: 'border-box' });
    element.addEventListener(READER_RESIZED, leave);
    element.addEventListener(ROWS_RESIZED, toBottom);
    return () => {
      observer.disconnect();
      element.removeEventListener(READER_RESIZED, leave);
      element.removeEventListener(ROWS_RESIZED, toBottom);
    };
  }, []);

  // scrolled: a scroll event, not a size the story took.
  function settle(scrolled: boolean) {
    const element = scrollRef.current!;
    if (scrolled) {
      if (element.scrollTop === placed.current) return;
      placed.current = null;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (!scrolled && held.current && distance <= element.clientHeight) return;
    const bottom = atEnd(distance, stick.current);
    stick.current = bottom;
    setAway(!bottom);
    if (bottom) setUnread(false);
  }

  // Takes the view down itself: while stay holds it, the story growing leaves away unset, so no render would.
  function follow() {
    stick.current = true;
    held.current = false;
    toBottom();
    setAway(false);
    setUnread(false);
  }

  // Before a turn the user asked for: staying leaves the view for the reply's start to place.
  function beforeTurn() {
    if (!stay) follow();
  }

  // Not following, which would take the view back down in the same render.
  function seekTo(key: string, lands: Seek['lands']) {
    stick.current = false;
    setSeek({ key, revision: Date.now(), lands });
  }

  const onScroll = () => settle(true);

  const pill = !away ? null : streaming ? '생성 중' : unread ? '새 응답' : '맨 아래로';

  return { scrollRef, onScroll, follow, beforeTurn, seekTo, seek, pill, away };
}
