import { useLayoutEffect, type RefObject } from 'react';

// Named in StoryMessage.module.css, as data-reading.
export const MESSAGE = 'data-story-message';
export const READING = 'data-reading';
export const RAIL = 'data-rail';
// Not one view: a message a little taller than the screen kept a rail up nearly all the time (user, 2026-10-14).
const LONG = 2;

// Mark the middle-crossing message only when >=LONG view heights. Measure between header/composer,
// then bound rail length by sticky top → message end/composer; give it the share read above the composer.
export function useReadingRail(scrollRef: RefObject<HTMLElement | null>, footerRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const scroll = scrollRef.current!;
    const footer = footerRef.current!;
    let marked: HTMLElement | null = null;
    let frame = 0;
    const place = () => {
      frame = 0;
      const style = getComputedStyle(scroll);
      const gap = parseFloat(style.getPropertyValue('--space-16'));
      const top = scroll.getBoundingClientRect().top + parseFloat(style.getPropertyValue('--header-height'));
      const bottom = footer.getBoundingClientRect().top;
      const middle = (top + bottom) / 2;
      let reading: HTMLElement | null = null;
      let box: DOMRect | null = null;
      for (const message of scroll.querySelectorAll<HTMLElement>(`[${MESSAGE}]`)) {
        box = message.getBoundingClientRect();
        if (box.top <= middle && box.bottom >= middle) {
          reading = message;
          break;
        }
      }
      if (reading && box!.height < (bottom - top) * LONG) reading = null;
      if (reading !== marked) {
        marked?.removeAttribute(READING);
        reading?.setAttribute(READING, '');
        marked = reading;
      }
      if (!reading) return;
      const rail = reading.querySelector(`[${RAIL}]`)!.getBoundingClientRect();
      const share = Math.min(1, Math.max(0, (bottom - box!.top) / box!.height));
      reading.style.setProperty('--reading-length', `${Math.min(box!.bottom, bottom - gap) - Math.max(rail.top, top + gap)}px`);
      reading.style.setProperty('--reading-share', String(share));
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(place);
    };
    scroll.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(scroll.firstElementChild!);
    observer.observe(footer);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener('scroll', schedule);
      marked?.removeAttribute(READING);
    };
  }, [scrollRef, footerRef]);
}
