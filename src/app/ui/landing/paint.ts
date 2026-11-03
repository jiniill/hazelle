export type Box = { x: number; y: number; w: number; h: number };
// a b c d e f, as DOMMatrix: x' = a x + c y + e, y' = b x + d y + f.
export type Affine = readonly [number, number, number, number, number, number];
type Color = readonly [number, number, number, number];
type Stop = { at: number; color: Color };
// Center and radii are shares of the box the gradient fills.
export type Radial = { cx: number; cy: number; rx: number; ry: number; stops: readonly Stop[] };
// Where a picture's foot fades out, as shares of its height.
export type Fade = { from: number; to: number };

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

const parseColor = (text: string): Color | null => {
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

const share = (text: string) => (text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text));

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

const parseRadial = (args: string[]): Radial | null => {
  const prelude = parseStop(args[0]!) ? [] : args.shift()!.split(/\s+/);
  const stops = args.map(parseStop);
  if (stops.some((stop) => !stop)) return null;
  const at = prelude.indexOf('at');
  const cx = at < 0 ? 0.5 : share(prelude[at + 1]!);
  const cy = at < 0 ? 0.5 : share(prelude[at + 2]!);
  const size = (at < 0 ? prelude : prelude.slice(0, at)).filter((word) => word !== 'ellipse');
  const sized = size.length === 2;
  return { cx, cy, rx: sized ? share(size[0]!) : Math.min(cx, 1 - cx), ry: sized ? share(size[1]!) : Math.min(cy, 1 - cy), stops: placed(stops as { at: number | null; color: Color }[]) };
};

// A background-image's radial gradients, the bottom one first. Anything else in it paints nothing here.
export function parseGradients(image: string): Radial[] {
  return splitTop(image)
    .map((layer) => argsOf(layer, 'radial-gradient'))
    .flatMap((args) => (args ? [parseRadial(args)].filter((radial): radial is Radial => !!radial) : []))
    .reverse();
}

// A mask-image of one top-to-bottom linear gradient from opaque to clear.
export function parseFade(mask: string): Fade | null {
  const stops = argsOf(mask, 'linear-gradient')?.map(parseStop);
  if (!stops || stops.length !== 2 || stops.some((stop) => !stop)) return null;
  const [from, to] = placed(stops as { at: number | null; color: Color }[]);
  return { from: from!.at, to: to!.at };
}

const VERTEX = `#version 300 es
in vec2 corner;
uniform vec4 box;
uniform mat3 place;
uniform vec2 screen;
uniform vec4 window;
out vec2 inBox;
out vec2 uv;
void main() {
  vec2 at = (place * vec3(box.xy + corner * box.zw, 1.0)).xy;
  inBox = corner;
  uv = window.xy + corner * window.zw;
  gl_Position = vec4(at.x / screen.x * 2.0 - 1.0, 1.0 - at.y / screen.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 inBox;
in vec2 uv;
uniform sampler2D picture;
uniform bool glow;
uniform float opacity;
uniform vec2 fade;
uniform vec4 shape;
uniform int count;
uniform float at[4];
uniform vec4 color[4];
out vec4 paint;
void main() {
  vec4 colored;
  if (glow) {
    float reach = length((inBox - shape.xy) / shape.zw);
    colored = color[0];
    for (int stop = 1; stop < 4; stop++) {
      if (stop >= count) break;
      colored = mix(colored, color[stop], clamp((reach - at[stop - 1]) / max(at[stop] - at[stop - 1], 0.0001), 0.0, 1.0));
    }
  } else {
    colored = texture(picture, uv) * (1.0 - clamp((inBox.y - fade.x) / max(fade.y - fade.x, 0.0001), 0.0, 1.0));
  }
  paint = colored * opacity;
}`;

const MOST_STOPS = 4;
const NO_FADE: Fade = { from: 2, to: 3 };
const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };

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
  const u = { box: spot('box'), place: spot('place'), screen: spot('screen'), window: spot('window'), glow: spot('glow'), opacity: spot('opacity'), fade: spot('fade'), shape: spot('shape'), count: spot('count'), at: spot('at'), color: spot('color') };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // One texture per picture file, shared by every plane that shows it, and the time it arrived for its fade in.
  const pictures = new Map<string, { texture: WebGLTexture | null; arrived: number }>();
  const pictureOf = (img: HTMLImageElement) => {
    const source = img.currentSrc;
    if (!source || !img.complete || !img.naturalWidth) return null;
    const known = pictures.get(source);
    if (known) return known.texture ? known : null;
    const entry = { texture: null as WebGLTexture | null, arrived: 0 };
    pictures.set(source, entry);
    void img.decode().then(() => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry.texture = texture;
      entry.arrived = performance.now();
      uploaded();
    }, () => pictures.delete(source));
    return null;
  };

  const placeAt = (box: Box, place: Affine, opacity: number) => {
    gl.uniform4f(u.box, box.x, box.y, box.w, box.h);
    gl.uniformMatrix3fv(u.place, false, [place[0], place[1], 0, place[2], place[3], 0, place[4], place[5], 1]);
    gl.uniform1f(u.opacity, opacity);
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
    picture(texture: WebGLTexture, box: Box, place: Affine, opacity: number, window: Box = WHOLE, fade: Fade = NO_FADE) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u.glow, 0);
      gl.uniform4f(u.window, window.x, window.y, window.w, window.h);
      gl.uniform2f(u.fade, fade.from, fade.to);
      placeAt(box, place, opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    glow(radial: Radial, box: Box, place: Affine, opacity: number) {
      const stops = radial.stops.slice(0, MOST_STOPS);
      gl.uniform1i(u.glow, 1);
      gl.uniform4f(u.shape, radial.cx, radial.cy, radial.rx, radial.ry);
      gl.uniform1i(u.count, stops.length);
      gl.uniform1fv(u.at, [...stops.map((stop) => stop.at), ...Array<number>(MOST_STOPS - stops.length).fill(1)]);
      gl.uniform4fv(u.color, [...stops.flatMap((stop) => stop.color), ...Array<number>((MOST_STOPS - stops.length) * 4).fill(0)]);
      placeAt(box, place, opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
