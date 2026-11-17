import { useCallback, useContext, useEffect, type RefObject } from 'react';
import { Held } from './Shell';
import styles from './ToolFrame.module.css';

type Props = { title: string; sandbox: string; allow: string; onMount: (window: Window) => () => void };

export function ToolFrame({ title, sandbox, allow, onMount }: Props) {
  const attach = useCallback((frame: HTMLIFrameElement | null) => {
    if (frame?.contentWindow) return onMount(frame.contentWindow);
  }, [onMount]);
  return <iframe ref={attach} className={styles.frame} title={title} sandbox={sandbox} allow={allow} src="/sandbox.html?role=page" referrerPolicy="no-referrer" />;
}

type Place = (frame: HTMLIFrameElement | null) => void;

// Where a frame that already exists is shown: it is held over this box, never moved into it.
export function FrameSlot({ title, onMount }: { title: string; onMount: (place: Place) => () => void }) {
  const attach = useCallback((slot: HTMLDivElement | null) => {
    if (!slot) return;
    let placed: HTMLIFrameElement | null = null;
    const fit = () => {
      if (!placed) return;
      const box = slot.getBoundingClientRect();
      Object.assign(placed.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    };
    const place: Place = (frame) => {
      if (placed && placed !== frame) {
        placed.classList.remove(styles.placed);
        Object.assign(placed.style, { left: '', top: '', width: '', height: '' });
        placed.hidden = true;
      }
      placed = frame;
      if (!frame) return;
      frame.title = title;
      frame.classList.add(styles.placed);
      frame.hidden = false;
      fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(slot);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    const detach = onMount(place);
    return () => {
      detach();
      place(null);
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [title, onMount]);
  return <div ref={attach} className={styles.slot} />;
}

type Box = [number, number, number, number];
type Region = { takes: Box[]; shows: Box[] };
type Miss = 'down' | 'up' | 'over';
type Layer = { draw(frame: HTMLIFrameElement | null, region: Region): void; missed(what: Miss): void };
type Laid = { taken(): void; close(): void };
// How long after a touch that was not the frame's the frame stays let go: a tap's click is aimed anew when the touch
// ends, and must not land on the frame.
const HOLD_MS = 350;
// How long its holder is still before it is put back to its middle.
const REST_MS = 800;

// A laid frame's hold on pointer input. held: it takes input. mouse: it was let go for a mouse, which it is given back
// by where the mouse is, never by time.
export type Hold = { held: boolean; mouse: boolean };
const HELD: Hold = { held: true, mouse: false };
// What the screen hears: the frame's word of a pointer on nothing of its own, or a pointer of the screen's own, with
// whether it is on a box that takes input (takes) or on one that only shows (shows).
export type Heard = { on: 'missed'; what: Miss } | { on: 'move' | 'down' | 'up' | 'click'; mouse: boolean; takes: boolean; shows: boolean };
// The hold after it. after: in how many ms the frame takes input again; null withdraws that wait, absent leaves it.
export function holdAfter(hold: Hold, heard: Heard): { hold: Hold; after?: number | null } {
  const waits = !hold.held && !hold.mouse;
  switch (heard.on) {
    case 'missed': return heard.what !== 'up' ? { hold: { held: false, mouse: heard.what === 'over' }, after: null } : waits ? { hold, after: HOLD_MS } : { hold };
    case 'move': return heard.mouse && !hold.held && (heard.takes || !heard.shows) ? { hold: HELD, after: null } : { hold };
    case 'down': return heard.mouse ? { hold } : { hold: heard.takes ? HELD : hold, after: null };
    case 'up': return !heard.mouse && waits ? { hold, after: HOLD_MS } : { hold };
    case 'click': return waits ? { hold, after: 0 } : { hold };
  }
}

const HEARD: Record<string, Exclude<Heard['on'], 'missed'>> = { pointermove: 'move', pointerdown: 'down', pointerup: 'up', pointercancel: 'up', click: 'click' };

// A frame laid over the whole screen as a layer (design §6.10): it is seen on its boxes alone, and everything else is
// the app's.
// - The clip keeps a press and a tap outside the boxes for the app.
// - A scroll is aimed by the boxes' bounds, not their shape, and outside its own lists the frame can use none. The
//   frame's holder is a scroller over those bounds which nothing can press: such a scroll passes to it by the
//   browser's rule, and the chat is moved by as much. The frame cannot stand in the chat's own scroller instead: an
//   iframe put elsewhere is loaded again.
// - A box that only shows is pressed through. The frame takes pointer input wherever it shows, says when a pointer is
//   on nothing of its own, and is let go (styles.released) until that touch has ended and its click has been aimed,
//   or until the mouse is over no such box; it is told when it has its input back (holdAfter).
// - The frame stands in the body, over a LayerWindow too: it is not laid while one holds the page.
export function FrameLayer({ scrollRef, onMount }: { scrollRef: RefObject<HTMLElement | null>; onMount: (layer: Layer) => Laid }) {
  const held = useContext(Held);
  useEffect(() => {
    if (held) return;
    let laid: HTMLIFrameElement | null = null;
    let region: Region = { takes: [], shows: [] };
    let hold = HELD;
    let again = 0;
    let rest = 0;
    let at = 0;
    const set = (next: Hold) => {
      const back = !hold.held && next.held;
      hold = next;
      laid?.classList.toggle(styles.released, !next.held);
      if (back) handle.taken();
    };
    const hear = (heard: Heard) => {
      const next = holdAfter(hold, heard);
      if (next.after !== undefined) window.clearTimeout(again);
      if (typeof next.after === 'number') again = window.setTimeout(() => set(HELD), next.after);
      set(next.hold);
    };
    const within = (boxes: Box[], { clientX, clientY }: PointerEvent) => boxes.some(([left, top, right, bottom]) => clientX >= left && clientX < right && clientY >= top && clientY < bottom);
    const pointed = (event: Event) => {
      const pointer = event as PointerEvent;
      hear({ on: HEARD[event.type]!, mouse: pointer.pointerType === 'mouse', takes: within(region.takes, pointer), shows: within(region.shows, pointer) });
    };
    for (const type of Object.keys(HEARD)) window.addEventListener(type, pointed, { capture: true, passive: true });
    const middle = (holder: HTMLElement) => (holder.scrollHeight - holder.clientHeight) / 2;
    const centre = (holder: HTMLElement) => {
      holder.scrollTop = middle(holder);
      at = holder.scrollTop;
    };
    const scrolled = (event: Event) => {
      const holder = event.currentTarget as HTMLElement;
      const by = holder.scrollTop - at;
      at = holder.scrollTop;
      if (by && scrollRef.current) scrollRef.current.scrollTop += by;
      // Put back to its middle only when far from it and at rest: a wheel that arrives as the app scrolls the holder
      // itself is taken by the holder, past the frame's own lists.
      window.clearTimeout(rest);
      rest = window.setTimeout(() => { if (Math.abs(holder.scrollTop - middle(holder)) > middle(holder) / 2) centre(holder); }, REST_MS);
    };
    const draw: Layer['draw'] = (frame, next) => {
      if (laid && laid !== frame) {
        const holder = laid.parentElement!;
        window.clearTimeout(again);
        window.clearTimeout(rest);
        holder.removeEventListener('scroll', scrolled);
        holder.classList.remove(styles.holder);
        Object.assign(holder.style, { left: '', top: '', width: '', height: '' });
        laid.classList.remove(styles.layer, styles.released);
        Object.assign(laid.style, { clipPath: '', transform: '' });
        laid.hidden = true;
        hold = HELD;
      }
      const fresh = laid !== frame;
      laid = frame;
      region = next;
      if (!frame) return;
      const holder = frame.parentElement!;
      const seen = [...next.takes, ...next.shows];
      const edge = (at: 0 | 1 | 2 | 3, most: (...values: number[]) => number) => (seen.length ? most(...seen.map((box) => box[at])) : 0);
      const [left, top, right, bottom] = [edge(0, Math.min), edge(1, Math.min), edge(2, Math.max), edge(3, Math.max)];
      Object.assign(holder.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      frame.style.transform = `translate(${-left}px, ${-top}px)`;
      frame.style.clipPath = seen.length ? `path("${seen.map(([l, t, r, b]) => `M${l} ${t}H${r}V${b}H${l}Z`).join('')}")` : 'polygon(0 0, 0 0, 0 0)';
      if (!fresh) return;
      holder.classList.add(styles.holder);
      frame.classList.add(styles.layer);
      frame.hidden = false;
      holder.addEventListener('scroll', scrolled, { passive: true });
      centre(holder);
    };
    const handle = onMount({ draw, missed: (what) => hear({ on: 'missed', what }) });
    return () => {
      handle.close();
      draw(null, { takes: [], shows: [] });
      for (const type of Object.keys(HEARD)) window.removeEventListener(type, pointed, { capture: true });
    };
  }, [scrollRef, onMount, held]);
  return null;
}
