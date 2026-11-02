import { describe, expect, it } from 'vitest';
import { hangingFrom, push, swing } from './hanging';

describe('a hanging lantern', () => {
  it('swings the way it is pushed, its tag trails, and it comes to rest', () => {
    const lantern = hangingFrom(3.4, 0);
    push(lantern, 3);
    for (let frame = 0; frame < 30; frame++) swing(lantern, 1 / 60, 0);
    expect(lantern.angle).toBeGreaterThan(0.5);
    expect(lantern.tag).toBeLessThan(0);
    for (let frame = 0; frame < 60 * 60; frame++) swing(lantern, 1 / 60, 0);
    expect(Math.abs(lantern.angle)).toBeLessThan(0.05);
  });
});
