import { describe, expect, it } from 'vitest';
import { parseFade, parseGradients } from './paint';

describe('parseGradients', () => {
  it('reads a token as written and as a browser computes it, bottom layer first', () => {
    const [shadow, light] = parseGradients('radial-gradient(50% 56% at 52% 60%, rgba(255, 180, 96, 0.24), rgba(255, 180, 96, 0.06) 62%, rgba(0, 0, 0, 0)), radial-gradient(closest-side, #06071ea6 40%, transparent)');
    expect(light).toMatchObject({ cx: 0.52, cy: 0.6, rx: 0.5, ry: 0.56 });
    expect(light!.stops.map((stop) => stop.at)).toEqual([0, 0.62, 1]);
    expect(light!.stops[0]!.color[3]).toBeCloseTo(0.24);
    expect(shadow).toMatchObject({ cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 });
    expect(shadow!.stops.map((stop) => stop.at)).toEqual([0.4, 1]);
    expect(shadow!.stops[0]!.color[0]).toBeCloseTo((6 / 255) * (0xa6 / 255));
    expect(parseGradients('radial-gradient(closest-side at center bottom, #fff, transparent)')[0]).toMatchObject({ cx: 0.5, cy: 1 });
  });
});

describe('parseFade', () => {
  it('reads where a foot mask starts and ends', () => {
    expect(parseFade('linear-gradient(rgb(0, 0, 0) 96%, rgba(0, 0, 0, 0))')).toEqual({ from: 0.96, to: 1 });
    expect(parseFade('none')).toBeNull();
  });
});
