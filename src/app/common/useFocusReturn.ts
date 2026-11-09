import { useLayoutEffect, useRef } from 'react';

// Focus given back as something open in place closes and takes the focus with it (a pick's bar, the chat's search, a
// message's edit), as a dialog's trap gives it back to its opener: to back's element, else to what held the focus as
// it opened. Focus that moved on to something still on the page stays there.
export function useFocusReturn(open: boolean, back?: () => HTMLElement | null) {
  const opener = useRef<HTMLElement | null>(null);
  const was = useRef(open);
  const latest = useRef(back);
  latest.current = back;
  // A layout effect: it reads the opener before what opened takes the focus in its own effect, and finds the focus on
  // BODY once what closed has left the page.
  useLayoutEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    if (open && !was.current) opener.current = focused;
    if (!open && was.current && (!focused || focused === document.body)) {
      const to = latest.current?.() ?? opener.current;
      if (to?.isConnected) to.focus();
    }
    was.current = open;
  }, [open]);
}
