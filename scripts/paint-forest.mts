// Paints the first page's forest (ui/landing/art) in a headless browser. Run: tsx scripts/paint-forest.mts [out dir] [only]
// The pictures are committed: a visitor downloads what was looked at here, on any browser, and spends no CPU painting it.
// arin.webp and cabin.webp in the same folder are illustrations, not painted here.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const out = process.argv[2] ?? 'src/app/ui/landing/art';
const only = process.argv[3];

function painter() {
  type Color = [number, number, number];
  type Shape = { width: number; height: number; gapX: number; tall: boolean };
  type Glow = { x: number; y: number; reach: number };
  type Palette = { deep: Color; body: Color; rim: Color; warm: Color; warmth: number };
  const hex = (value: string): Color => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
  const mix = (a: Color, b: Color, t: number): Color => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = ([r, g, b]: Color, alpha = 1) => `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
  const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const canvas = (width: number, height: number) => {
    const element = document.createElement('canvas');
    element.width = width;
    element.height = height;
    return { element, ctx: element.getContext('2d')! };
  };
  const wave = (random: () => number) => {
    const parts = Array.from({ length: 5 }, (_, index) => ({ f: (index + 1) * (0.6 + random() * 0.8), p: random() * 6.28, a: 1 / (index + 1) }));
    return (x: number) => parts.reduce((sum, { f, p, a }) => sum + Math.sin(x * f * 6.28 + p) * a, 0) / 2;
  };
  const softDot = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: Color, alpha: number, stretch = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, stretch);
    const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    fill.addColorStop(0, css(color, alpha));
    fill.addColorStop(0.45, css(color, alpha * 0.42));
    fill.addColorStop(1, css(color, 0));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 6.283);
    ctx.fill();
    ctx.restore();
  };

  const MOON_DIR = { x: 0.55, y: -0.83 };

  function limb(ctx: CanvasRenderingContext2D, points: [number, number, number][]) {
    ctx.beginPath();
    const side = (index: number, sign: number) => {
      const [x, y, w] = points[index]!;
      const next = points[Math.min(index + 1, points.length - 1)]!;
      const before = points[Math.max(index - 1, 0)]!;
      const angle = Math.atan2(next[1] - before[1], next[0] - before[0]) + (sign * Math.PI) / 2;
      return [x + (Math.cos(angle) * w) / 2, y + (Math.sin(angle) * w) / 2] as const;
    };
    points.forEach((_, index) => ctx.lineTo(...side(index, 1)));
    for (let index = points.length - 1; index >= 0; index--) ctx.lineTo(...side(index, -1));
    ctx.closePath();
    ctx.fill();
  }

  type TreeOptions = { x: number; base: number; height: number; palette: Palette; glow: Glow; leaf: number; density: number; clearing?: { x: number; y: number; rx: number; ry: number } | undefined; spread?: number };

  function tree(ctx: CanvasRenderingContext2D, random: () => number, { x, base, height, palette, glow, leaf, density, clearing, spread = 1 }: TreeOptions) {
    const limbs: [number, number, number][][] = [];
    const tips: { x: number; y: number; r: number }[] = [];
    const inClearing = (px: number, py: number) => !!clearing && ((px - clearing.x) / clearing.rx) ** 2 + ((py - clearing.y) / clearing.ry) ** 2 < 1;
    const grow = (px: number, py: number, angle: number, length: number, width: number, depth: number) => {
      const points: [number, number, number][] = [[px, py, width]];
      let cx = px, cy = py, a = angle;
      for (let step = 1; step <= 6; step++) {
        a += (random() - 0.5) * 0.3;
        cx += (Math.cos(a) * length) / 6;
        cy += (Math.sin(a) * length) / 6;
        points.push([cx, cy, width * (1 - (0.36 * step) / 6)]);
      }
      if (depth < 4 && inClearing(cx, cy)) return;
      limbs.push(points);
      if (depth === 0) {
        tips.push({ x: cx, y: cy, r: height * (0.05 + random() * 0.055) });
        return;
      }
      const children = 2 + (random() > 0.45 ? 1 : 0);
      for (let child = 0; child < children; child++) {
        const turn = ((child + 0.5) / children - 0.5) * 1.35 * spread + (random() - 0.5) * 0.55;
        grow(cx, cy, a + turn + (-Math.PI / 2 - a) * 0.2, length * (0.62 + random() * 0.24), width * 0.6, depth - 1);
      }
    };
    grow(x, base + height * 0.02, -Math.PI / 2 + (random() - 0.5) * 0.1, height * (0.34 + random() * 0.12), height * (0.036 + random() * 0.018), 4);

    // Back leaves, then the wood, then the lit leaves: wood shows in the gaps and the crown keeps its volume.
    const sorted = [...tips].sort((a, b) => a.y - b.y);
    const center = { x: tips.reduce((s, t) => s + t.x, 0) / Math.max(tips.length, 1), y: tips.reduce((s, t) => s + t.y, 0) / Math.max(tips.length, 1) };
    const dabs = (tip: (typeof tips)[number], share: number, front: boolean) => {
      const count = Math.min(420, ((tip.r / leaf) ** 2 * density * share) | 0);
      for (let k = 0; k < count; k++) {
        const a = random() * 6.283;
        const d = Math.sqrt(random()) * tip.r;
        const lx = tip.x + Math.cos(a) * d;
        const ly = tip.y + Math.sin(a) * d * 0.8;
        if (inClearing(lx, ly)) continue;
        const nx = (lx - tip.x) / tip.r;
        const ny = (ly - tip.y) / tip.r;
        const edge = Math.hypot(nx, ny);
        const towardMoon = nx * MOON_DIR.x + ny * MOON_DIR.y;
        const crownSide = ((lx - center.x) * MOON_DIR.x + (ly - center.y) * MOON_DIR.y) / (height * 0.35);
        const lit = clamp(towardMoon * 0.6 + crownSide * 0.5 + edge * 0.1 + (random() - 0.5) * 0.3);
        let color = mix(palette.deep, palette.body, clamp(0.3 - ny * 0.45 + (random() - 0.5) * 0.5));
        if (front) color = mix(color, palette.rim, lit ** 3.4);
        const toGlow = clamp(1 - Math.hypot(lx - glow.x, ly - glow.y) / glow.reach);
        color = mix(color, palette.warm, toGlow ** 3 * palette.warmth * clamp(0.3 + ny * 0.7));
        ctx.fillStyle = css(color);
        const size = leaf * (0.75 + random() * 0.6);
        ctx.beginPath();
        ctx.ellipse(lx, ly, size, size * (0.55 + random() * 0.25), random() * 3.14, 0, 6.283);
        ctx.fill();
      }
    };
    sorted.forEach((tip) => dabs(tip, 0.45, false));
    ctx.fillStyle = css(palette.deep);
    limbs.forEach((points) => limb(ctx, points));
    // The trunk's moonlit side: a thin, broken line, never a stripe.
    const trunk = limbs[0]!;
    ctx.fillStyle = css(mix(palette.deep, palette.rim, 0.22));
    for (let i = 0; i < trunk.length - 1; i++) {
      if (random() < 0.3) continue;
      limb(ctx, [trunk[i]!, trunk[i + 1]!].map(([px, py, w]) => [px + w * 0.34, py, w * 0.1]));
    }
    sorted.forEach((tip) => dabs(tip, 0.55, true));
  }

  function ground(ctx: CanvasRenderingContext2D, random: () => number, shape: Shape, top: number, gap: { half: number; dip: number }, palette: Palette, glow: Glow) {
    const { width, height, gapX } = shape;
    const roll = wave(random);
    const clumps = wave(random);
    const x0 = gapX * width;
    const edge = (x: number) => top + roll(x / width) * height * 0.016 + clamp(1 - Math.abs(x - x0) / gap.half) ** 1.5 * gap.dip;
    const fill = ctx.createLinearGradient(0, top, 0, Math.min(height, top + height * 0.2));
    fill.addColorStop(0, css(mix(palette.deep, palette.body, 0.7)));
    fill.addColorStop(1, css(palette.deep));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 6) ctx.lineTo(x, edge(x));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = 'round';
    for (let k = 0; k < width * 0.9; k++) {
      const x = random() * width;
      const u = x / width;
      if (random() > 0.3 + clamp(clumps(u * 4) + 0.3) * 0.7) continue;
      const y = edge(x) + random() * height * 0.03;
      const tall = height * (0.006 + random() ** 2.4 * 0.03) * (0.7 + clamp(clumps(u * 2 + 0.3) + 0.5));
      const lean = (random() - 0.4) * tall * 0.8;
      const toGlow = clamp(1 - Math.hypot(x - glow.x, y - glow.y) / glow.reach);
      let color = mix(palette.deep, palette.body, random());
      color = mix(color, palette.rim, random() ** 5 * 0.45);
      color = mix(color, palette.warm, toGlow ** 3 * palette.warmth * 0.7);
      ctx.strokeStyle = css(color);
      ctx.lineWidth = height * 0.0014 + random() * height * 0.001;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.2, y - tall * 0.6, x + lean, y - tall);
      ctx.stroke();
    }
  }

  type RowOptions = { seed: number; palette: Palette; top: number; gapHalf: number; dip: number; trees: number; tall: [number, number]; blur: number; leaf: number; density: number; clearing: { y: number; rx: number; ry: number } };

  function row(shape: Shape, options: RowOptions) {
    const { element, ctx } = canvas(shape.width, shape.height);
    const { width, height, gapX } = shape;
    const random = seeded(options.seed);
    const unit = Math.min(width, height * 1.3);
    const glow = { x: gapX * width, y: 0.74 * height, reach: Math.max(width, height) * 0.4 };
    const x0 = gapX * width;
    const halfGap = options.gapHalf * width;
    const clearing = { x: x0, y: options.clearing.y * height, rx: options.clearing.rx * width, ry: options.clearing.ry * height };
    const top = options.top * height;
    const places: { x: number; size: number }[] = [];
    for (let k = 0; k < options.trees; k++) {
      const x = ((k + 0.5 + (random() - 0.5) * 0.9) / options.trees) * width * 1.2 - width * 0.1;
      const size = options.tall[0] + random() * (options.tall[1] - options.tall[0]);
      const crown = top - size * height * 0.42;
      if (Math.abs(x - x0) < halfGap * (0.85 + random() * 0.4)) continue;
      if (((x - clearing.x) / clearing.rx) ** 2 + ((crown - clearing.y) / clearing.ry) ** 2 < 1) continue;
      places.push({ x, size });
    }
    places.sort((a, b) => b.size - a.size);
    for (const place of places) {
      tree(ctx, random, { x: place.x, base: top + (random() - 0.5) * height * 0.012, height: place.size * height, palette: options.palette, glow, leaf: options.leaf * unit, density: options.density, clearing });
    }
    ground(ctx, random, shape, top, { half: halfGap * 1.6, dip: options.dip * height }, options.palette, glow);
    if (!options.blur) return element;
    // Once over the finished picture: a filter set while drawing runs on every leaf.
    const soft = canvas(width, height);
    soft.ctx.filter = `blur(${options.blur}px)`;
    soft.ctx.drawImage(element, 0, 0);
    return soft.element;
  }

  const PALETTES = {
    far: { deep: hex('#24285a'), body: hex('#2d3268'), rim: hex('#5f66a8'), warm: hex('#b08c7c'), warmth: 0.1 },
    mid: { deep: hex('#141738'), body: hex('#1d2150'), rim: hex('#5d65ac'), warm: hex('#c9975f'), warmth: 0.22 },
    near: { deep: hex('#0a0b22'), body: hex('#111334'), rim: hex('#5a62ad'), warm: hex('#e0a55c'), warmth: 0.36 },
    hill: { deep: hex('#0e0a1c'), body: hex('#1a1228'), rim: hex('#e8996a'), warm: hex('#f5b97f'), warmth: 0 },
  } satisfies Record<string, Palette>;

  function sky(shape: Shape) {
    const { element, ctx } = canvas(shape.width, shape.height);
    const { width, height, gapX } = shape;
    const random = seeded(3);
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, '#060820');
    fill.addColorStop(0.32, '#0c0f30');
    fill.addColorStop(0.58, '#1b1e52');
    fill.addColorStop(0.74, '#3a3a78');
    fill.addColorStop(1, '#2a2a5e');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
    // A faint river of stars crossing the moon's side of the sky.
    const river = (u: number) => ({ x: u * width, y: height * (0.62 - u * 0.62) });
    for (let k = 0; k < 90; k++) {
      const { x, y } = river(random());
      softDot(ctx, x + (random() - 0.5) * width * 0.08, y + (random() - 0.5) * height * 0.16, width * (0.05 + random() * 0.07), hex('#5a5aa8'), 0.05, 0.6);
    }
    const stars = (count: number, near: boolean) => {
      for (let k = 0; k < count; k++) {
        let x: number, y: number;
        if (near) {
          const at = river(random());
          x = at.x + (random() - 0.5) * (random() - 0.5) * width * 0.34;
          y = at.y + (random() - 0.5) * (random() - 0.5) * height * 0.6;
        } else {
          x = random() * width;
          y = random() ** 1.3 * height * 0.72;
        }
        const power = random() ** 9;
        const color = mix(hex('#cfd6ff'), random() > 0.7 ? hex('#ffe6c4') : hex('#ffffff'), random());
        ctx.fillStyle = css(color, 0.16 + random() * 0.3 + power * 0.6);
        ctx.beginPath();
        ctx.arc(x, y, (0.5 + power * 1.3) * (shape.tall ? 1 : 1.1), 0, 6.283);
        ctx.fill();
        if (power > 0.62) softDot(ctx, x, y, 4 + power * 6, color, 0.2);
      }
    };
    stars(shape.tall ? 500 : 900, false);
    stars(shape.tall ? 420 : 900, true);
    // Mist over the horizon, where the forest stands.
    softDot(ctx, gapX * width, height * 0.76, width * 0.9, hex('#6c6bb0'), 0.22, 0.28);
    return element;
  }

  function moon() {
    const size = 400;
    const { element, ctx } = canvas(size, size);
    const c = size / 2;
    const r = size * 0.48;
    const random = seeded(19);
    ctx.beginPath();
    ctx.arc(c, c, r, 0, 6.283);
    ctx.clip();
    const disc = ctx.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r);
    disc.addColorStop(0, '#fffaf0');
    disc.addColorStop(0.72, '#fbefd4');
    disc.addColorStop(1, '#ecd8ae');
    ctx.fillStyle = disc;
    ctx.fillRect(0, 0, size, size);
    // Seas, then a dusting of small craters.
    [[-0.3, -0.26, 0.46], [0.24, -0.34, 0.3], [-0.06, 0.1, 0.38], [0.36, 0.24, 0.24], [-0.44, 0.34, 0.2]].forEach(([dx, dy, rr]) => {
      for (let k = 0; k < 26; k++) softDot(ctx, c + (dx! + (random() - 0.5) * rr! * 1.5) * r, c + (dy! + (random() - 0.5) * rr! * 1.5) * r, r * rr! * (0.18 + random() * 0.34), hex('#bfae94'), 0.1);
    });
    for (let k = 0; k < 70; k++) softDot(ctx, c + (random() - 0.5) * r * 2, c + (random() - 0.5) * r * 2, r * (0.008 + random() * 0.024), hex('#a99a80'), 0.24);
    return element;
  }

  function ridge(shape: Shape) {
    const { element, ctx } = canvas(shape.width, shape.height);
    const { width, height } = shape;
    const random = seeded(31);
    [[0.655, '#20224e', 0.02], [0.685, '#181a40', 0.024]].forEach(([top, color, swing]) => {
      const roll = wave(random);
      ctx.fillStyle = color as string;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 8) ctx.lineTo(x, height * ((top as number) + roll(x / width) * (swing as number)));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      for (let x = 0; x <= width; x += 3 + random() * 9) {
        const y = height * ((top as number) + roll(x / width) * (swing as number));
        const r = height * (0.004 + random() * 0.009);
        ctx.beginPath();
        ctx.arc(x, y - r * 0.5, r, 0, 6.283);
        ctx.fill();
      }
    });
    const soft = canvas(width, height);
    soft.ctx.filter = `blur(${width > 1200 ? 2.5 : 1.5}px)`;
    soft.ctx.drawImage(element, 0, 0);
    return soft.element;
  }

  // The hazel: a round-toothed leaf, and the long catkins it wears through winter.
  function hazelLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, color: Color, vein: Color, rim: Color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(size, size);
    ctx.fillStyle = css(color);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(0.22, -0.48, 0.74, -0.46, 1, -0.06);
    ctx.lineTo(1.14, 0);
    ctx.lineTo(1, 0.06);
    ctx.bezierCurveTo(0.74, 0.46, 0.22, 0.48, 0, 0);
    ctx.fill();
    ctx.strokeStyle = css(vein);
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(1.05, 0);
    for (let k = 1; k <= 5; k++) {
      const at = k * 0.16;
      ctx.moveTo(at, 0);
      ctx.lineTo(at + 0.16, -0.26 * Math.sin(at * 3.14) - 0.02);
      ctx.moveTo(at, 0);
      ctx.lineTo(at + 0.16, 0.26 * Math.sin(at * 3.14) + 0.02);
    }
    ctx.stroke();
    ctx.strokeStyle = css(rim);
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    ctx.moveTo(0.1, -0.2);
    ctx.bezierCurveTo(0.3, -0.42, 0.74, -0.44, 1, -0.06);
    ctx.stroke();
    ctx.restore();
  }

  function catkin(ctx: CanvasRenderingContext2D, random: () => number, x: number, y: number, length: number, thick: number) {
    const lean = (random() - 0.5) * 0.18;
    const beads = (length / (thick * 0.35)) | 0;
    for (let k = 0; k < beads; k++) {
      const t = k / beads;
      const px = x + Math.sin(t * 1.8) * lean * length + (random() - 0.5) * thick * 0.55 * (1 - t * 0.4);
      const py = y + t * length;
      const lit = clamp((px - x) / thick + 0.5 + (random() - 0.5) * 0.5);
      ctx.fillStyle = css(mix(hex('#3e3320'), hex('#d8b46a'), lit ** 1.6 * (0.55 + random() * 0.45)));
      ctx.beginPath();
      ctx.ellipse(px, py, thick * 0.3, thick * 0.2, random() * 3, 0, 6.283);
      ctx.fill();
    }
  }

  function bough(shape: Shape) {
    const { element, ctx } = canvas(shape.width, shape.height);
    const { width, height } = shape;
    const random = seeded(53);
    const unit = shape.tall ? width * 1.5 : width;
    const deep = hex('#04050f');
    const body = hex('#0a0c22');
    const vein = hex('#181b40');
    const rim = hex('#4a50a0');
    const sprays: [number, number, number, number][] = [];
    const twig = (x: number, y: number, angle: number, length: number, thick: number, depth: number) => {
      const points: [number, number, number][] = [[x, y, thick]];
      let cx = x, cy = y, a = angle;
      for (let step = 1; step <= 8; step++) {
        a += (random() - 0.5) * 0.14 + 0.012;
        cx += (Math.cos(a) * length) / 8;
        cy += (Math.sin(a) * length) / 8;
        points.push([cx, cy, thick * (1 - (0.55 * step) / 8)]);
        if (depth < 2 || step > 2) sprays.push([cx, cy, a, depth]);
      }
      ctx.fillStyle = css(deep);
      limb(ctx, points);
      if (depth <= 0) return;
      for (let child = 0; child < 3; child++) {
        const from = points[2 + child * 2]!;
        twig(from[0], from[1], a + (child % 2 ? 0.7 : -0.5) + (random() - 0.5) * 0.3, length * (0.5 + random() * 0.15), thick * 0.5, depth - 1);
      }
    };
    twig(width * 1.02, -height * 0.015, Math.PI * (shape.tall ? 0.86 : 0.88), unit * (shape.tall ? 0.2 : 0.2), unit * 0.01, 2);
    twig(width * 0.92, -height * 0.02, Math.PI * 0.68, unit * 0.1, unit * 0.006, 1);
    // Catkins hang behind the leaves.
    sprays.filter((_, index) => index % 7 === 3).forEach(([x, y]) => {
      for (let k = 0; k < 2 + ((random() * 2) | 0); k++) catkin(ctx, random, x + (random() - 0.5) * unit * 0.012, y, unit * (0.035 + random() * 0.03), unit * 0.006);
    });
    sprays.filter((_, index) => index % 2 === 0).forEach(([x, y, a]) => {
      const size = unit * (0.02 + random() * 0.018);
      const angle = a + (random() > 0.5 ? 1 : -1) * (0.5 + random() * 0.7);
      hazelLeaf(ctx, x, y, size, angle, mix(deep, body, random()), vein, mix(body, rim, 0.3 + random() * 0.5));
    });
    return element;
  }

  // 아린, side on, facing the lantern she holds out: skirt, capelet and hood as three cut shapes, lit where each edge meets the light.
  const ARIN = {
    skirt: 'M238 500 C230 680 214 880 186 1030 C226 1046 268 1034 312 1044 C372 1056 430 1034 490 1046 C556 1056 618 1040 664 1020 C612 860 566 660 522 480 Z',
    capelet: 'M292 306 C262 358 222 450 200 560 C232 582 268 566 306 580 C352 596 408 566 456 584 C490 594 530 576 556 556 C530 450 492 356 448 296 C400 276 340 280 292 306 Z',
    hood: 'M286 214 C288 150 336 104 396 110 C452 116 488 164 486 224 C486 256 500 288 528 318 C490 326 464 322 446 316 C396 352 322 348 282 318 C274 284 280 248 286 214 Z',
    opening: 'M306 214 C310 170 346 142 388 146 C378 182 372 232 360 270 C350 298 332 318 306 320 C296 288 300 248 306 214 Z',
    cheek: 'M326 214 C316 226 310 244 306 258 C302 266 296 272 296 276 C298 280 304 280 308 282 C306 290 308 296 312 298 C310 304 314 308 320 306 C338 304 350 280 352 252 C354 234 344 216 326 214 Z',
    sleeve: 'M252 438 C218 436 186 440 158 448 C148 452 146 474 156 480 C190 486 226 490 262 488 Z',
    hand: 'M160 446 C150 444 138 448 134 456 C130 466 136 478 146 480 C154 480 160 476 162 470 Z',
  };

  function crook(ctx: CanvasRenderingContext2D, width: number, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(158, 1042);
    ctx.lineTo(138, 300);
    ctx.bezierCurveTo(134, 222, 58, 214, 44, 278);
    ctx.stroke();
  }

  function hill(shape: Shape) {
    const { element, ctx } = canvas(shape.width, shape.height);
    const { width, height, gapX, tall } = shape;
    const random = seeded(71);
    const palette = PALETTES.hill;
    const roll = wave(random);
    const edge = (x: number) => height * (0.76 + (((x / width - gapX) * (tall ? 0.7 : 1)) ** 2) * 0.5 + roll(x / width) * 0.014);
    const treeX = (gapX + (tall ? 0.26 : 0.19)) * width;
    const glow = { x: gapX * width, y: height, reach: 1 };
    tree(ctx, random, { x: treeX, base: edge(treeX), height: height * (tall ? 0.25 : 0.4), palette, glow, leaf: Math.min(width, height) * 0.0036, density: 3.2, spread: 1.25 });
    ctx.fillStyle = css(palette.deep);
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 6) ctx.lineTo(x, edge(x));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = 'round';
    for (let k = 0; k < width * 1.1; k++) {
      const x = random() * width;
      const tallness = height * (0.004 + random() ** 3 * 0.018);
      ctx.strokeStyle = css(mix(palette.deep, palette.rim, random() ** 6 * 0.8));
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, edge(x) + 4);
      ctx.lineTo(x + (random() - 0.4) * tallness * 0.7, edge(x) - tallness);
      ctx.stroke();
    }
    const figureX = (gapX - (tall ? 0.12 : 0.05)) * width;
    const figure = height * (tall ? 0.06 : 0.085);
    ctx.save();
    ctx.translate(figureX, edge(figureX) + figure * 0.02);
    ctx.scale(figure / 950, figure / 950);
    ctx.translate(-400, -1040);
    ctx.fillStyle = css(palette.deep);
    [ARIN.skirt, ARIN.sleeve, ARIN.capelet, ARIN.hood].forEach((path) => ctx.fill(new Path2D(path)));
    crook(ctx, 12, css(palette.deep));
    softDot(ctx, 44, 372, 340, hex('#ffcf85'), 1);
    ctx.fillStyle = '#fff3cf';
    ctx.fillRect(18, 342, 52, 68);
    ctx.restore();
    return element;
  }

  // Grain over everything: long dark gradients band on a phone without it.
  function grain() {
    const { element, ctx } = canvas(128, 128);
    const random = seeded(83);
    const image = ctx.createImageData(128, 128);
    for (let k = 0; k < image.data.length; k += 4) {
      const value = random() > 0.5 ? 255 : 0;
      image.data[k] = value;
      image.data[k + 1] = value;
      image.data[k + 2] = value;
      image.data[k + 3] = random() * 9;
    }
    ctx.putImageData(image, 0, 0);
    return element;
  }

  return {
    sky,
    moon,
    ridge,
    bough,
    hill,
    grain,
    rowA: (shape: Shape) => row(shape, { seed: 11, palette: PALETTES.far, top: 0.71, gapHalf: shape.tall ? 0.1 : 0.05, dip: 0.012, trees: shape.tall ? 10 : 22, tall: [0.22, 0.34], blur: shape.tall ? 1 : 1.5, leaf: 0.0036, density: 0.95, clearing: { y: 0.28, rx: shape.tall ? 0.46 : 0.17, ry: 0.32 } }),
    rowB: (shape: Shape) => row(shape, { seed: 23, palette: PALETTES.mid, top: 0.77, gapHalf: shape.tall ? 0.2 : 0.085, dip: 0.024, trees: shape.tall ? 6 : 13, tall: [0.42, 0.62], blur: 0, leaf: 0.0046, density: 0.9, clearing: { y: 0.26, rx: shape.tall ? 0.58 : 0.24, ry: 0.36 } }),
    rowD: (shape: Shape) => row(shape, { seed: 67, palette: PALETTES.near, top: 0.8, gapHalf: shape.tall ? 0.14 : 0.05, dip: 0.03, trees: shape.tall ? 5 : 11, tall: [0.68, 0.96], blur: 0, leaf: 0.005, density: 0.9, clearing: { y: 0.16, rx: shape.tall ? 0.3 : 0.11, ry: 0.22 } }),
    rowC: (shape: Shape) => row(shape, { seed: 41, palette: PALETTES.near, top: 0.84, gapHalf: shape.tall ? 0.34 : 0.15, dip: 0.04, trees: shape.tall ? 3 : 7, tall: [0.82, 1.08], blur: 0, leaf: 0.0058, density: 0.95, clearing: { y: 0.28, rx: shape.tall ? 0.7 : 0.33, ry: 0.42 } }),
  };
}

const WIDE = { width: 2000, height: 1125, gapX: 0.62, tall: false };
const TALL = { width: 900, height: 1600, gapX: 0.5, tall: true };
type Job = { name: string; call: string; quality: number };
const shaped = (part: string, quality: number, size = 1): Job[] => [WIDE, TALL].map((shape) => ({ name: `${part}-${shape.tall ? 'tall' : 'wide'}`, call: `${part}(${JSON.stringify({ ...shape, width: Math.round(shape.width * size), height: Math.round(shape.height * size) })})`, quality }));
const JOBS: Job[] = [
  ...shaped('sky', 0.72),
  ...shaped('ridge', 0.6),
  ...shaped('rowA', 0.5, 0.6),
  ...shaped('rowB', 0.62, 0.86),
  ...shaped('rowC', 0.7),
  ...shaped('rowD', 0.6, 0.85),
  ...shaped('bough', 0.72),
  ...shaped('hill', 0.72),
  { name: 'moon', call: 'moon()', quality: 0.8 },
  { name: 'grain', call: 'grain()', quality: 0.9 },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
// tsx wraps named functions in __name, which a page does not have.
await page.evaluate('globalThis.__name = (fn) => fn');
let total = 0;
for (const { name, call, quality } of JOBS) {
  if (only && !only.split(',').some((part) => name.includes(part))) continue;
  const data = await page.evaluate(`(${painter.toString()})().${call}.toDataURL('image/webp', ${quality})`) as string;
  const bytes = Buffer.from(data.split(',')[1]!, 'base64');
  await writeFile(join(out, `${name}.webp`), bytes);
  total += bytes.length;
  console.log(name, Math.round(bytes.length / 1024), 'KB');
}
console.log('total', Math.round(total / 1024), 'KB');
await browser.close();
