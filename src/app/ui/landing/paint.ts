export type Box = { x: number; y: number; w: number; h: number };
// a b c d e f, as DOMMatrix: x' = a x + c y + e, y' = b x + d y + f.
export type Affine = readonly [number, number, number, number, number, number];
export type Color = readonly [number, number, number, number];
type Stop = { at: number; color: Color };
// Radial center and radii are shares of the box the gradient fills; a circle's closest side is only known with its box.
export type Gradient = { kind: 'radial'; cx: number; cy: number; rx: number; ry: number; circle: boolean; stops: readonly Stop[] } | { kind: 'linear'; stops: readonly Stop[] };
// Where a picture's foot fades out, as shares of its height.
export type Fade = { from: number; to: number };
export type Shadow = { color: Color; blur: number; spread: number };

export const times = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
export const shift = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
// A CSS transform with its transform-origin.
export const about = (x: number, y: number, m: Affine): Affine => times(times(shift(x, y), m), shift(-x, -y));
export const scaling = (by: number): Affine => [by, 0, 0, by, 0, 0];
export const skewingX = (degrees: number): Affine => [1, 0, Math.tan((degrees * Math.PI) / 180), 1, 0, 0];
export const turning = (degrees: number): Affine => {
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
};

const splitTop = (text: string) => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === '(') depth++;
    else if (text[at] === ')') depth--;
    else if (text[at] === ',' && depth === 0) {
      parts.push(text.slice(from, at).trim());
      from = at + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
};

const argsOf = (text: string, name: string) => (text.startsWith(`${name}(`) && text.endsWith(')') ? splitTop(text.slice(name.length + 1, -1)) : null);

// Premultiplied, as CSS gradients interpolate.
const premultiplied = (r: number, g: number, b: number, a: number): Color => [(r / 255) * a, (g / 255) * a, (b / 255) * a, a];

export const parseColor = (text: string): Color | null => {
  if (text === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const [r, g, b, a = 255] = full.match(/../g)!.map((pair) => parseInt(pair, 16));
    return premultiplied(r!, g!, b!, a / 255);
  }
  const channels = /^rgba?\((.*)\)$/.exec(text)?.[1]?.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) return null;
  return premultiplied(channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1);
};

const PLACES: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
// A position or a stop as a share of its box: browsers may give a place as a keyword.
export const share = (text: string) => PLACES[text] ?? parseFloat(text) / (text.endsWith('%') ? 100 : 1);

const parseStop = (text: string): { at: number | null; color: Color } | null => {
  const split = text.endsWith(')') ? text.length : text.search(/\s[\d.-]+%?$/);
  const color = parseColor((split < 0 ? text : text.slice(0, split)).trim());
  if (!color) return null;
  return { color, at: split < 0 || split === text.length ? null : share(text.slice(split).trim()) };
};

// CSS's fix-up: a first stop without a place stands at 0, a last at 1, the ones between spread evenly.
const placed = (stops: { at: number | null; color: Color }[]): Stop[] => {
  const at = stops.map((stop) => stop.at);
  if (at[0] === null) at[0] = 0;
  if (at.at(-1) === null) at[at.length - 1] = 1;
  for (let index = 1; index < at.length; index++) {
    if (at[index] !== null) {
      at[index] = Math.max(at[index]!, at[index - 1]!);
      continue;
    }
    const next = at.findIndex((place, later) => later > index && place !== null);
    at[index] = at[index - 1]! + (at[next]! - at[index - 1]!) / (next - index + 1);
  }
  return stops.map((stop, index) => ({ at: at[index]!, color: stop.color }));
};

const stopsOf = (args: string[]) => {
  const stops = args.map(parseStop);
  return stops.some((stop) => !stop) ? null : placed(stops as { at: number | null; color: Color }[]);
};

const parseRadial = (args: string[]): Gradient | null => {
  const prelude = parseStop(args[0]!) ? [] : args.shift()!.split(/\s+/);
  const stops = stopsOf(args);
  if (!stops) return null;
  const at = prelude.indexOf('at');
  const cx = at < 0 ? 0.5 : share(prelude[at + 1]!);
  const cy = at < 0 ? 0.5 : share(prelude[at + 2]!);
  const words = at < 0 ? prelude : prelude.slice(0, at);
  const size = words.filter((word) => word !== 'ellipse' && word !== 'circle');
  const sized = size.length === 2;
  return { kind: 'radial', cx, cy, rx: sized ? share(size[0]!) : Math.min(cx, 1 - cx), ry: sized ? share(size[1]!) : Math.min(cy, 1 - cy), circle: words.includes('circle'), stops };
};

// A background-image's gradients, the bottom one first. Of linear ones only top-to-bottom paints; anything else in it paints nothing here.
export function parseGradients(image: string): Gradient[] {
  return splitTop(image)
    .flatMap((layer): Gradient[] => {
      const radial = argsOf(layer, 'radial-gradient');
      if (radial) return [parseRadial(radial)].filter((gradient) => !!gradient);
      const linear = argsOf(layer, 'linear-gradient');
      const stops = linear ? stopsOf(linear) : null;
      return stops ? [{ kind: 'linear', stops }] : [];
    })
    .reverse();
}

// A mask-image of one top-to-bottom linear gradient from opaque to clear.
export function parseFade(mask: string): Fade | null {
  const args = argsOf(mask, 'linear-gradient');
  const stops = args?.length === 2 ? stopsOf(args) : null;
  return stops ? { from: stops[0]!.at, to: stops[1]!.at } : null;
}

// A box-shadow's layers, the top one first, as a browser computes it (color first) or as a token writes it (color last). Offsets are not kept: the scene's shadows have none.
export function parseShadows(text: string): Shadow[] {
  if (text === 'none') return [];
  return splitTop(text).flatMap((layer) => {
    const written = /rgba?\([^)]*\)|#[0-9a-f]+/i.exec(layer)?.[0];
    const color = written ? parseColor(written) : null;
    const lengths = layer.replace(written ?? '', '').trim().split(/\s+/).map(parseFloat);
    return color ? [{ color, blur: lengths[2] ?? 0, spread: lengths[3] ?? 0 }] : [];
  });
}

// A disk blurred in two dimensions: an edge-on erfc would light a small disk's center up to three times too bright.
const RINGS = 24;
const blurredDisk = (distance: number, radius: number, sigma: number) => {
  if (!sigma) return Number(distance <= radius);
  let sum = 0;
  for (let i = 0; i < RINGS; i++) {
    const r = ((i + 0.5) / RINGS) * radius;
    for (let j = 0; j < RINGS; j++) sum += r * Math.exp(-(r * r + distance * distance - 2 * r * distance * Math.cos(((j + 0.5) / RINGS) * Math.PI)) / (2 * sigma * sigma));
  }
  return (sum * (radius / RINGS) * (Math.PI / RINGS) * 2) / (2 * Math.PI * sigma * sigma);
};

const over = (top: Color, under: Color): Color => [top[0] + under[0] * (1 - top[3]), top[1] + under[1] * (1 - top[3]), top[2] + under[2] * (1 - top[3]), top[3] + under[3] * (1 - top[3])];
const times4 = (color: Color, by: number): Color => [color[0] * by, color[1] * by, color[2] * by, color[3] * by];

const MOST_STOPS = 12;

// A round element of one color over its blurred shadows, as one radial gradient reaching `reach` from its center.
export function roundGlow(core: Color, radius: number, shadows: readonly Shadow[]): { reach: number; gradient: Gradient } {
  const reach = Math.max(radius, ...shadows.map(({ spread, blur }) => radius + spread + blur * 1.5));
  const shadowAt = (distance: number) =>
    [...shadows].reverse().reduce<Color>((under, { color, blur, spread }) => over(times4(color, blurredDisk(distance, radius + spread, blur / 2)), under), [0, 0, 0, 0]);
  const places = Array.from({ length: MOST_STOPS }, (_, index) => (index === 0 ? 0 : radius + (reach - radius) * ((index - 1) / (MOST_STOPS - 2)) ** 2));
  return {
    reach,
    gradient: { kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, circle: false, stops: places.map((distance) => ({ at: distance / reach, color: distance < radius ? over(core, shadowAt(distance)) : shadowAt(distance) })) },
  };
}

const VERTEX = `#version 300 es
in vec2 corner;
uniform vec4 box;
uniform mat3 place;
uniform vec2 screen;
uniform vec4 window;
out vec2 inBox;
out vec2 local;
out vec2 uv;
void main() {
  local = box.xy + corner * box.zw;
  vec2 at = (place * vec3(local, 1.0)).xy;
  inBox = corner;
  uv = window.xy + corner * window.zw;
  gl_Position = vec4(at.x / screen.x * 2.0 - 1.0, 1.0 - at.y / screen.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 inBox;
in vec2 local;
in vec2 uv;
uniform sampler2D picture;
uniform int shape;
uniform float opacity;
uniform vec2 fade;
uniform vec4 clip;
uniform vec4 ring;
uniform int count;
uniform float at[${MOST_STOPS}];
uniform vec4 color[${MOST_STOPS}];
out vec4 paint;
void main() {
  if (local.x < clip.x || local.y < clip.y || local.x > clip.z || local.y > clip.w) discard;
  vec4 colored;
  if (shape == 0) {
    colored = texture(picture, uv) * (1.0 - clamp((inBox.y - fade.x) / max(fade.y - fade.x, 0.0001), 0.0, 1.0));
  } else {
    float reach = shape == 1 ? length((inBox - ring.xy) / ring.zw) : inBox.y;
    colored = color[0];
    for (int stop = 1; stop < ${MOST_STOPS}; stop++) {
      if (stop >= count) break;
      colored = mix(colored, color[stop], clamp((reach - at[stop - 1]) / max(at[stop] - at[stop - 1], 0.0001), 0.0, 1.0));
    }
  }
  paint = colored * opacity;
}`;

const NO_FADE: Fade = { from: 2, to: 3 };
const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };
export const ANYWHERE: Box = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };

// null when the browser gives no WebGL2.
export function painterOn(canvas: HTMLCanvasElement, uploaded: () => void) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const compiled = (kind: number, source: string) => {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compiled(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compiled(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  const spot = (name: string) => gl.getUniformLocation(program, name);
  const u = { box: spot('box'), place: spot('place'), screen: spot('screen'), window: spot('window'), shape: spot('shape'), opacity: spot('opacity'), fade: spot('fade'), clip: spot('clip'), ring: spot('ring'), count: spot('count'), at: spot('at'), color: spot('color') };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // One texture per picture file, shared by every piece that shows it, and the time it arrived for its fade in.
  const pictures = new Map<string, { texture: WebGLTexture | null; arrived: number }>();
  const pictureOf = (img: HTMLImageElement, tiled = false) => {
    const source = img.currentSrc || img.src;
    if (!source || !img.complete || !img.naturalWidth) return null;
    const known = pictures.get(source);
    if (known) return known.texture ? known : null;
    const entry = { texture: null as WebGLTexture | null, arrived: 0 };
    pictures.set(source, entry);
    void img.decode().then(
      () => {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, tiled ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, tiled ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        entry.texture = texture;
        entry.arrived = performance.now();
        uploaded();
      },
      () => pictures.delete(source),
    );
    return null;
  };

  const placeAt = (box: Box, place: Affine, opacity: number, clip: Box) => {
    gl.uniform4f(u.box, box.x, box.y, box.w, box.h);
    gl.uniformMatrix3fv(u.place, false, [place[0], place[1], 0, place[2], place[3], 0, place[4], place[5], 1]);
    gl.uniform1f(u.opacity, opacity);
    gl.uniform4f(u.clip, clip.x, clip.y, clip.x + clip.w, clip.y + clip.h);
  };

  return {
    pictureOf,
    begin(width: number, height: number, density: number) {
      const wide = Math.round(width * density);
      const tall = Math.round(height * density);
      if (canvas.width !== wide || canvas.height !== tall) {
        canvas.width = wide;
        canvas.height = tall;
      }
      gl.viewport(0, 0, wide, tall);
      gl.uniform2f(u.screen, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    picture(texture: WebGLTexture, box: Box, place: Affine, opacity: number, clip: Box, window: Box = WHOLE, fade: Fade = NO_FADE) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u.shape, 0);
      gl.uniform4f(u.window, window.x, window.y, window.w, window.h);
      gl.uniform2f(u.fade, fade.from, fade.to);
      placeAt(box, place, opacity, clip);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    gradient(gradient: Gradient, box: Box, place: Affine, opacity: number, clip: Box) {
      const stops = gradient.stops.slice(0, MOST_STOPS);
      gl.uniform1i(u.shape, gradient.kind === 'radial' ? 1 : 2);
      if (gradient.kind === 'radial') {
        const side = Math.min(gradient.cx * box.w, (1 - gradient.cx) * box.w, gradient.cy * box.h, (1 - gradient.cy) * box.h);
        gl.uniform4f(u.ring, gradient.cx, gradient.cy, gradient.circle ? side / box.w : gradient.rx, gradient.circle ? side / box.h : gradient.ry);
      }
      gl.uniform1i(u.count, stops.length);
      gl.uniform1fv(u.at, [...stops.map((stop) => stop.at), ...Array<number>(MOST_STOPS - stops.length).fill(1)]);
      gl.uniform4fv(u.color, [...stops.flatMap((stop) => stop.color), ...Array<number>((MOST_STOPS - stops.length) * 4).fill(0)]);
      placeAt(box, place, opacity, clip);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
