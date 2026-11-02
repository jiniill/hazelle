import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import type { PriceTable } from '../connectors/models-dev';
import { START_PAGE } from '../contracts/start';
import { GUIDE_INDEX, GUIDES, type Guide } from '../contracts/guides';
import { CALCULATOR_PAGE } from '../contracts/prices';
import { PULSE_PAGE, type PulseAnswer } from '../contracts/pulse';
import { TOOL_SANDBOX } from '../contracts/sandbox';
import { SHARE_ID, type ShareCover } from '../contracts/shares';
import { VISITOR_HEADER } from '../contracts/http';
import { HOSTED } from '../contracts/installation';
import type { PageVisit } from './visits';

// frame-src is also the tool pages' navigation boundary: adding any host there opens a way out for them.
export const CSP =
  "default-src 'self'; img-src 'self' data: blob:; media-src blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'";
// The page's own policy: CSP above, plus inline styles carrying this load's nonce (CodeMirror's stylesheet).
export const pageCsp = (nonce: string) => `${CSP}; style-src 'self' 'nonce-${nonce}'`;
// Vite writes this placeholder into the page wherever a nonce goes (vite.config html.cspNonce).
const NONCE = 'HAZELLE_NONCE';
export const SANDBOX_CSP = `sandbox ${TOOL_SANDBOX}; default-src 'none'; script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`;
// A frame whose module allowed the network (runtime/tools/frame.ts asks with ?network=1): pictures, fonts and the
// stylesheets that load webfonts may come from outside. connect-src stays closed; its fetches go through the host.
export const SANDBOX_NETWORK_CSP = SANDBOX_CSP.replace("img-src data: blob:", 'img-src data: blob: https:').replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https:").replace("font-src 'self' data:", "font-src 'self' data: https:");
// The two variants differ in URL, so a cached copy of one is never served for the other.
export const sandboxHeaders = (network: boolean) => ({ 'Content-Security-Policy': network ? SANDBOX_NETWORK_CSP : SANDBOX_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache' });
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
// Every file under /assets has a content hash in its name, so a changed file is a new URL.
const IMMUTABLE = 'public, max-age=31536000, immutable';
// Only pages whose words reach a crawler that runs no script; this set also drives the sitemap. The legal pages stay
// out: their text lives in the app, which the server may not import (design §6.13).
const INDEXED = new Set(['/', PULSE_PAGE.path, CALCULATOR_PAGE.path, GUIDE_INDEX.path, ...GUIDES.map((guide) => guide.path)]);
// The lists people compare by provider; the gateways' lists repeat these models at their own prices.
const PRICED: [list: string, label: string][] = [['anthropic', 'Anthropic'], ['google', 'Google'], ['openai', 'OpenAI'], ['deepseek', 'DeepSeek'], ['xai', 'xAI']];
const PULSE_LINE = '헤이젤 사용자들이 캐릭터 챗에 실제로 쓰는 AI 모델 순위예요.';
// selfHost: someone's own installation (node.ts), which no search engine lists and whose page says so to the client.
// What pages read from the API, which owns the database.
export type PageSources = { cover: (share: string) => Promise<ShareCover | null>; pulse: () => Promise<PulseAnswer>; prices: () => Promise<PriceTable> };

export function clientFiles(clientDir: string, sources: PageSources, visit: (page: PageVisit) => void = () => {}, selfHost = false) {
  const client = new Hono();
  client.use(async (c, next) => {
    const started = performance.now();
    await next();
    if (c.req.method === 'GET' && c.res.ok && c.res.headers.get('Content-Type')?.startsWith('text/html') && !c.req.path.startsWith('/assets/') && c.req.path !== '/api' && !c.req.path.startsWith('/api/')) {
      visit({ kind: 'visit', address: c.req.header(VISITOR_HEADER)!, agent: c.req.header('user-agent') ?? '' });
    }
    c.res.headers.set('Server-Timing', `static;dur=${(performance.now() - started).toFixed(1)}`);
    if (c.res.ok && /^(?:text\/|application\/(?:javascript|json|wasm)|image\/svg\+xml)/.test(c.res.headers.get('Content-Type') ?? '')) c.res.headers.set('Vary', 'Accept-Encoding');
  });
  const sandbox = serveStatic({ root: clientDir, path: 'sandbox.html', precompressed: true });
  client.get('/sandbox.html', async (c) => {
    for (const [name, value] of Object.entries(sandboxHeaders(c.req.query('network') === '1'))) c.header(name, value);
    return (await sandbox(c, async () => {})) || c.notFound();
  });
  const listed = (c: Context) => !selfHost && INDEXED.has(c.req.path);
  // shape rewrites the page after the nonce is in, so text it adds (a share's cover) can never become a nonce.
  const page = async (c: Context, shape: (html: string) => string = (html) => html) => {
    const nonce = randomBytes(18).toString('base64');
    c.header('Content-Security-Policy', pageCsp(nonce));
    if (!listed(c)) c.header('X-Robots-Tag', 'noindex');
    const html = (await readFile(join(clientDir, 'index.html'), 'utf8')).replaceAll(NONCE, nonce);
    // Read by main.tsx (runtime/installation.ts), before any request, so pages shown before sign-in know it too.
    if (selfHost) return c.html(shape(html.replace('<html', '<html data-self-host')));
    return c.html(shape(listed(c) ? canonical(html, c.req.path) : html));
  };
  client.use(async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(HEADERS)) c.res.headers.set(name, value);
    if (!c.res.headers.has('Content-Security-Policy')) c.res.headers.set('Content-Security-Policy', CSP);
    // ok, not 200: a Range answer (206) of an asset is as immutable as the whole.
    if (!c.res.ok) return;
    const asset = c.req.path.startsWith('/assets/');
    c.res.headers.set('Cache-Control', asset ? IMMUTABLE : 'no-cache');
    // A tool page's origin is opaque, so its stylesheet and fonts arrive as CORS fetches. Assets are public build files.
    if (asset) c.res.headers.set('Access-Control-Allow-Origin', '*');
  });
  client.get('/robots.txt', (c) => c.text(`User-agent: *\nDisallow: /api/\n${selfHost ? '' : `Sitemap: ${HOSTED}/sitemap.xml\n`}`));
  client.get('/sitemap.xml', (c) => (selfHost ? c.notFound() : c.body(SITEMAP, 200, { 'Content-Type': 'application/xml; charset=utf-8' })));
  client.get('/s/:id', async (c, next) => {
    const id = c.req.param('id');
    if (!SHARE_ID.test(id)) return next();
    const shared = await sources.cover(id);
    return page(c, (html) => sharePage(html, shared));
  });
  client.get(GUIDE_INDEX.path, (c) => page(c, guideIndexPage));
  client.get(`${GUIDE_INDEX.path}/:slug`, (c, next) => {
    const guide = GUIDES.find((each) => each.path === c.req.path);
    return guide ? page(c, (html) => guidePage(html, guide)) : next();
  });
  client.get(CALCULATOR_PAGE.path, async (c) => {
    // The page loads whatever the table does.
    const table = await sources.prices().catch(() => null);
    return page(c, (html) => calculatorPage(html, table));
  });
  client.get(PULSE_PAGE.path, async (c) => {
    // The page loads whatever the numbers do.
    const answer = await sources.pulse().catch(() => null);
    return page(c, (html) => (answer ? pulsePage(html, answer) : html));
  });
  const files = serveStatic({ root: clientDir, precompressed: true });
  // The page as a file would carry the placeholder, not a nonce.
  client.get('*', (c, next) => {
    if (c.req.path !== '/' && c.req.path !== '/index.html') return files(c, next);
    return page(c, (html) => {
      const named = worded(html, START_PAGE.title, START_PAGE.line);
      return listed(c) ? landingPage(named) : named;
    });
  });
  // Dots do not imply assets: provider model ids contain them. Serve SPA only for page loads; missing assets stay 404.
  client.get('*', (c) => {
    const load = !c.req.path.startsWith('/assets/') && c.req.header('accept')?.includes('text/html');
    return load ? page(c) : c.notFound();
  });
  return client;
}

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...INDEXED].map((path) => `<url><loc>${HOSTED}${path}</loc></url>`).join('')}</urlset>\n`;

const canonical = (html: string, path: string) =>
  html.replace('</head>', () => `<link rel="canonical" href="${HOSTED}${path}" /><meta property="og:url" content="${HOSTED}${path}" /></head>`);

// A page's words as markup, for a crawler that runs no script (Naver's). main.tsx's createRoot replaces them.
const withWords = (html: string, words: string) =>
  html.replace(/<p class="boot" role="status">([^<]*)<\/p>/, (_, loading: string) => `<main class="boot landing">${words}<p role="status">${loading}</p></main>`);

function landingPage(html: string): string {
  const facts = { '@context': 'https://schema.org', '@type': 'WebApplication', name: '헤이젤', alternateName: 'Hazelle', url: `${HOSTED}/`, description: START_PAGE.line, applicationCategory: 'EntertainmentApplication', operatingSystem: 'Web', inLanguage: 'ko', offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' } };
  const list = (items: readonly string[], tag = 'ul') => `<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`;
  const { heading, line, keys, trial, features, move } = START_PAGE;
  const words = `<h1>${heading}</h1><p>${line}</p><h2>${keys.title}</h2><p>${keys.line}</p><h2>${trial.title}</h2>${list(trial.steps, 'ol')}<p>${trial.privacy}</p><h2>${features.title}</h2>${list(features.points)}<p><a href="${move.path}">${move.label}</a> · <a href="${GUIDE_INDEX.path}">${GUIDE_INDEX.title}</a> · <a href="${CALCULATOR_PAGE.path}">${CALCULATOR_PAGE.title}</a> · <a href="${PULSE_PAGE.path}">${PULSE_PAGE.title}</a></p>`;
  return withWords(html.replace('</head>', () => `<script type="application/ld+json">${JSON.stringify(facts)}</script></head>`), words);
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function worded(html: string, title: string, line: string): string {
  const [named, said] = [escape(title), escape(line)];
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${named}</title>`)
    .replace(/<meta property="og:title" content="[^"]*"/, () => `<meta property="og:title" content="${named}"`)
    .replace(/<meta name="description" content="[^"]*"/, () => `<meta name="description" content="${said}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, () => `<meta property="og:description" content="${said}"`);
}

const titled = (title: string) => `${title} · 헤이젤`;

function guideIndexPage(html: string): string {
  const rows = GUIDES.map((guide) => `<li><a href="${guide.path}">${guide.title}</a></li>`).join('');
  return withWords(worded(html, titled(GUIDE_INDEX.title), GUIDE_INDEX.line), `<h1>${GUIDE_INDEX.title}</h1><p>${GUIDE_INDEX.line}</p><ul>${rows}</ul>`);
}

function guidePage(html: string, guide: Guide): string {
  const sections = guide.sections.map(({ title, blocks }) => {
    const words = blocks.map((block) => {
      if (typeof block === 'string') return `<p>${block}</p>`;
      if ('steps' in block) return `<ol>${block.steps.map((step) => `<li>${step}</li>`).join('')}</ol>`;
      return 'link' in block ? `<p><a href="${block.link}">${block.label}</a></p>` : '';
    });
    return `<h2>${title}</h2>${words.join('')}`;
  });
  return withWords(worded(html, titled(guide.title), guide.line), `<h1>${guide.title}</h1><p>${guide.line}</p>${sections.join('')}`);
}

function calculatorPage(html: string, table: PriceTable | null): string {
  const lists = PRICED.flatMap(([list, label]) => {
    const rows = (table?.models ?? []).flatMap((model) => (model.list === list && model.price ? `<li>${escape(model.name ?? model.model)}: 입력 $${model.price.input} · 출력 $${model.price.output}</li>` : []));
    return rows.length ? `<h2>${label}</h2><ul>${rows.join('')}</ul>` : [];
  });
  return withWords(worded(html, titled(CALCULATOR_PAGE.title), CALCULATOR_PAGE.line), `<h1>${CALCULATOR_PAGE.title}</h1><p>${CALCULATOR_PAGE.line}</p>${lists.length ? `<p>100만 토큰당 가격이에요.</p>${lists.join('')}` : ''}`);
}

// A share link's page: the app's page, whose embed carries the sharer's opt-in cover as text, or the app's own words
// when there is none. Never a picture, not even the app's: an embed of a share shows text only.
export function sharePage(html: string, cover: ShareCover | null): string {
  const page = html.replace(/\s*<meta property="og:image[^>]*>/g, '').replace(/<meta name="twitter:card" content="[^"]*"/, '<meta name="twitter:card" content="summary"');
  return cover ? worded(page, cover.creator ? `${cover.name} · ${cover.creator}` : cover.name, cover.line) : page;
}

// 헤이젤 나우's page: the app's page, picture included, whose embed tells the board's numbers; the app's own words
// while there is no board.
function pulsePage(html: string, { board }: PulseAnswer): string {
  if (!board) return html;
  const count = (value: number) => value.toLocaleString('ko-KR');
  // 기타 never headlines.
  const named = board.ranking.chat.merged.flatMap((row) => row.model ?? []);
  const line = `최근 24시간 응답 ${count(board.replies)}번 · 최근 7일 ${count(board.people)}명이 썼어요`;
  const ranks = named.map((model, index) => `<li>${index + 1}위 ${escape(model)}</li>`).join('');
  return withWords(
    worded(html, named[0] ? `${PULSE_PAGE.title} · 대화 1위 ${named[0]}` : PULSE_PAGE.title, line),
    `<h1>${PULSE_PAGE.title}</h1><p>${PULSE_LINE}</p><p>${line}</p>${ranks && `<h2>대화 모델 순위</h2><ul>${ranks}</ul>`}`,
  );
}
