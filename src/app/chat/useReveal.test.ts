import { describe, expect, it } from 'vitest';
import { pace, rested, revealCut, startPace } from './useReveal';

describe('pace', () => {
  it('spreads each arrival over the measured wait for the next one, and ends one wait after the last', () => {
    let current = startPace(0, 0);
    let now = 0;
    const frames = (until: number) => {
      for (; now < until; now += 16) current = pace(current, current.total, now);
    };
    for (let arrival = 1; arrival <= 20; arrival++) {
      frames(arrival * 200);
      current = pace(current, arrival * 100, now);
    }
    expect(current.gap).toBeGreaterThan(190);
    expect(current.gap).toBeLessThan(201);
    frames(now + 100);
    expect(current.shown).toBeGreaterThan(1940);
    expect(current.shown).toBeLessThan(1960);
    frames(now + 120);
    expect(current.shown).toBe(2000);
    expect(pace(current, 1500, now).shown).toBe(1500);
  });
});

describe('rested', () => {
  it('lets the next frame follow a step drawn quickly, and holds the next step back after a slow one', () => {
    expect(rested({ at: 100, took: 6 }, 116)).toBe(true);
    expect(rested({ at: 100, took: 12 }, 116)).toBe(false);
    expect(rested({ at: 100, took: 12 }, 133)).toBe(true);
  });
});

describe('revealCut', () => {
  it('never ends inside a tag, and leaves a < in prose alone', () => {
    const picture = '<div class="risu-inlay-image"><img src="blob:x"></div>\n';
    const img = picture.indexOf('<img');
    const close = picture.indexOf('</div>');
    expect(revealCut(picture, close + 1)).toBe(close);
    expect(revealCut(picture, close + 2)).toBe(close);
    expect(revealCut(picture, img + 8)).toBe(img);
    expect(revealCut(picture, close)).toBe(close);
    expect(revealCut(picture, picture.length)).toBe(picture.length);
    expect(revealCut('a < b and <3 more', 3)).toBe(3);
    expect(revealCut('a <3 more', 3)).toBe(3);
  });
});
