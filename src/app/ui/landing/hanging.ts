import { useEffect, type RefObject } from 'react';
import { MEDIA } from '../foundation/media';
import { stillness } from './walkStops';

const DAMPING = 0.07;
const TAG_PERIOD = 1.3;
const TAG_DAMPING = 0.18;
const TAG_LAG = 0.9;
const BREEZE = 0.8;
const SPEED_MOST = 5;
const PUSH_PER_PIXEL = 0.09;
const TAP_PUSH = 3;
const GUST_FADES = 0.97;
const GUST_FULL_AT = 40;
const GUST_GROWS = 2.5;
const LONGEST_STEP = 1 / 30;

export type Hanging = { angle: number; speed: number; tag: number; tagSpeed: number; turns: number; seed: number };

export const hangingFrom = (period: number, seed: number): Hanging => ({ angle: 0, speed: 0, tag: 0, tagSpeed: 0, turns: (2 * Math.PI) / period, seed });

// A breeze that never repeats within a visit: three slow waves out of step, shifted by the lantern's own seed.
export const breezeAt = (time: number, seed: number) => BREEZE * (Math.sin(time * 0.7 + seed) + 0.6 * Math.sin(time * 1.9 + seed * 2) + 0.3 * Math.sin(time * 0.31 + seed * 3));

// Angles in degrees. A pendulum on its rope; the tag on its cords answers the lantern's speed, so it trails behind.
export function swing(hung: Hanging, step: number, force: number) {
  hung.speed += (force - hung.turns * hung.turns * hung.angle - 2 * DAMPING * hung.turns * hung.speed) * step;
  hung.angle += hung.speed * step;
  const tagTurns = (2 * Math.PI) / TAG_PERIOD;
  hung.tagSpeed += (tagTurns * tagTurns * (-hung.speed * TAG_LAG - hung.tag) - 2 * TAG_DAMPING * tagTurns * hung.tagSpeed) * step;
  hung.tag += hung.tagSpeed * step;
}

export const push = (hung: Hanging, by: number) => {
  hung.speed = Math.min(Math.max(hung.speed + by, -SPEED_MOST), SPEED_MOST);
};

// Different lengths of rope swing at different periods. A phone's lanterns share one rope, so they swing as one.
const PERIODS = [3.4, 4.1, 3.7];

export function useHanging(list: RefObject<HTMLElement | null>, lanterns: string, tags: string) {
  useEffect(() => {
    if (stillness()) return;
    const place = list.current!;
    const links = [...place.querySelectorAll<HTMLElement>(lanterns)];
    const cards = links.map((link) => link.querySelector<HTMLElement>(tags)!);
    const oneRope = matchMedia(MEDIA.phone).matches;
    const hung = links.map((_, index) => hangingFrom(PERIODS[oneRope ? 0 : index]!, oneRope ? 0 : index * 2.1));
    const touched = (target: EventTarget | null) => {
      const at = links.findIndex((link) => link.contains(target as Node));
      if (at < 0) return [];
      return oneRope ? hung : [hung[at]!];
    };

    let frame = 0;
    let last = 0;
    let lastScroll = scrollY;
    let gust = 0;
    const draw = (now: number) => {
      const step = Math.min((now - last) / 1000, LONGEST_STEP);
      last = now;
      gust = Math.max(gust * GUST_FADES, Math.min(Math.abs(scrollY - lastScroll) / GUST_FULL_AT, 1));
      lastScroll = scrollY;
      hung.forEach((one, index) => {
        swing(one, step, breezeAt(now / 1000, one.seed) * (1 + gust * GUST_GROWS));
        links[index]!.style.transform = `rotate(${one.angle.toFixed(3)}deg)`;
        cards[index]!.style.transform = `rotate(${one.tag.toFixed(3)}deg)`;
      });
      frame = requestAnimationFrame(draw);
    };
    const inSight = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!entry!.isIntersecting) return;
      last = performance.now();
      lastScroll = scrollY;
      frame = requestAnimationFrame(draw);
    });
    inSight.observe(place);

    const moved = ({ target, movementX, pointerType }: PointerEvent) => {
      if (pointerType !== 'mouse') return;
      for (const one of touched(target)) push(one, movementX * PUSH_PER_PIXEL);
    };
    // A finger has no way across, so it pushes away from where it lands.
    const pressed = ({ target, clientX, pointerType }: PointerEvent) => {
      if (pointerType === 'mouse') return;
      const link = links.find((one) => one.contains(target as Node));
      if (!link) return;
      const { left, width } = link.getBoundingClientRect();
      for (const one of touched(target)) push(one, clientX < left + width / 2 ? TAP_PUSH : -TAP_PUSH);
    };
    place.addEventListener('pointermove', moved, { passive: true });
    place.addEventListener('pointerdown', pressed, { passive: true });
    return () => {
      inSight.disconnect();
      cancelAnimationFrame(frame);
      place.removeEventListener('pointermove', moved);
      place.removeEventListener('pointerdown', pressed);
    };
  }, []);
}
