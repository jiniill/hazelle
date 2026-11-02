// Draws public/'s favicon, icons and link preview from the one mark (src/app/ui/foundation/mark.ts) and the wordmark
// fonts kept here and beside the app's fonts. Run `npm run brand` after changing either; the outputs are committed.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { MARK } from '../src/app/ui/foundation/mark.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => path.join(root, 'public', name);
const ink = '#131216';
const cream = '#f1ece4';
const gold = '#e6b35c';
const [width, height] = MARK.viewBox.split(' ').slice(2).map(Number);

const mark = (x, y, size, color) => `<g transform="translate(${x} ${y}) scale(${size / width})"><path fill="${color}" fill-rule="evenodd" d="${MARK.path}"/></g>`;
const centered = (box, size, color) => mark((box - size) / 2, (box - (size * height) / width) / 2, size, color);
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// The tab icon follows the browser's scheme: ink on a light tab, gold on a dark one.
await writeFile(out('favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK.viewBox}"><style>path{fill:${ink}}@media(prefers-color-scheme:dark){path{fill:${gold}}}</style><path fill-rule="evenodd" d="${MARK.path}"/></svg>\n`);

const base64 = async (file) => (await readFile(file)).toString('base64');
const fonts = `@font-face{font-family:Hangul;src:url(data:font/woff2;base64,${await base64(path.join(root, 'src/app/ui/foundation/fonts/NanumSquareRoundEB-hazelle.woff2'))})}
@font-face{font-family:Latin;src:url(data:font/ttf;base64,${await base64(path.join(root, 'brand/Poppins-Medium.ttf'))})}`;

const icon = (box) => svg(box, box, `<rect width="${box}" height="${box}" rx="${box * 0.22}" fill="${ink}"/>${centered(box, box * 0.64, gold)}`);
// Maskable icons are cropped to a circle or squircle inside the outer 10 %, so the mark stays within the middle 60 %.
const maskable = (box) => svg(box, box, `<rect width="${box}" height="${box}" fill="${ink}"/>${centered(box, box * 0.56, gold)}`);
const art = async (name) => `url(data:image/webp;base64,${await base64(path.join(root, 'src/app/ui/landing/art', `${name}.webp`))})`;
const layer = async (name, css = '') => `<div style="position:absolute;inset:0;background:${await art(name)} 62% 100%/cover no-repeat;${css}"></div>`;
// The link preview is the first page's own forest, redrawn by this file whenever ui/landing/art changes.
const preview = `<div style="position:relative;width:1200px;height:630px;overflow:hidden;background:#0a0a22">
  ${await layer('sky-wide')}
  <div style="position:absolute;top:44px;left:876px;width:126px;height:126px;background:${await art('moon')} center/contain no-repeat"></div>
  ${await layer('ridge-wide')}${await layer('rowA-wide')}${await layer('rowB-wide')}${await layer('rowC-wide')}
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,#0a0a22d9 0,#0a0a2299 42%,transparent 68%)"></div>
  <div style="position:absolute;top:150px;left:788px;width:260px;height:260px;background:radial-gradient(closest-side,#ffd59a80,#ffb46026 56%,transparent)"></div>
  <div style="position:absolute;bottom:42px;left:826px;width:355px;height:480px;background:${await art('arin')} center/contain no-repeat"></div>
  <div style="position:absolute;inset:0">${svg(1200, 630, `${mark(84, 226, 150, gold)}<text x="262" y="325" font-family="Hangul" font-size="112" fill="${cream}" letter-spacing="-2">헤이젤</text><text x="266" y="382" font-family="Latin" font-size="36" fill="${cream}" fill-opacity="0.72">Hazelle</text>`)}</div>
</div>`;

const files = [
  ['icon-192.png', 192, 192, icon(192)],
  ['icon-512.png', 512, 512, icon(512)],
  ['icon-maskable-512.png', 512, 512, maskable(512)],
  ['apple-touch-icon.png', 180, 180, icon(180)],
  ['og.jpg', 1200, 630, preview],
];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, w, h, body] of files) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>${fonts}html,body{margin:0;background:transparent}</style>${body}`);
  await page.evaluate('document.fonts.ready');
  await page.screenshot(name.endsWith('.jpg') ? { path: out(name), type: 'jpeg', quality: 86 } : { path: out(name), omitBackground: true });
}
await browser.close();
stdout.write(`brand: wrote favicon.svg and ${files.length} images to public/\n`);
