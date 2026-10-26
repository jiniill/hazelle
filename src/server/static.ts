import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { PULSE_PAGE, type PulseAnswer } from '../contracts/pulse';
import { TOOL_SANDBOX } from '../contracts/sandbox';
import { SHARE_ID, type ShareCover } from '../contracts/shares';
import { VISITOR_HEADER } from '../contracts/http';
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
// The pages a search engine may list (design §6.13): the guest home, which is the app's public face, 헤이젤 나우 and the
// two legal pages. Every other page load, share links and the 게시판 among them, says noindex.
const INDEXED = new Set(['/', PULSE_PAGE.path, '/terms', '/privacy']);
const LANDING = { title: '헤이젤 · RisuAI 봇으로 캐릭터 챗', line: 'RisuAI 봇과 포켓리스 백업을 가져와 내 API 키로 캐릭터 챗을 해요. 가입 없이 바로 써요.' };

// selfHost: someone's own installation (node.ts), which no search engine lists and whose page says so to the client.
export function clientFiles(clientDir: string, cover: (share: string) => Promise<ShareCover | null>, pulse: () => Promise<PulseAnswer>, visit: (page: PageVisit) => void = () => {}, selfHost = false) {
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
  // shape rewrites the page after the nonce is in, so text it adds (a share's cover) can never become a nonce.
  const page = async (c: Context, shape: (html: string) => string = (html) => html) => {
    const nonce = randomBytes(18).toString('base64');
    c.header('Content-Security-Policy', pageCsp(nonce));
    if (selfHost || !INDEXED.has(c.req.path)) c.header('X-Robots-Tag', 'noindex');
    const html = (await readFile(join(clientDir, 'index.html'), 'utf8')).replaceAll(NONCE, nonce);
    // Read by main.tsx (runtime/installation.ts), before any request, so pages shown before sign-in know it too.
    return c.html(shape(selfHost ? html.replace('<html', '<html data-self-host') : html));
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
  client.get('/s/:id', async (c, next) => {
    const id = c.req.param('id');
    if (!SHARE_ID.test(id) || !c.req.header('accept')?.includes('text/html')) return next();
    const shared = await cover(id);
    return page(c, (html) => sharePage(html, shared));
  });
  client.get(PULSE_PAGE.path, async (c, next) => {
    if (!c.req.header('accept')?.includes('text/html')) return next();
    // The page loads whatever the numbers do.
    const answer = await pulse().catch(() => null);
    return page(c, (html) => (answer ? pulsePage(html, answer) : html));
  });
  const files = serveStatic({ root: clientDir, precompressed: true });
  // The page as a file would carry the placeholder, not a nonce.
  client.get('*', (c, next) => (c.req.path === '/' || c.req.path === '/index.html' ? page(c, (html) => worded(html, LANDING.title, LANDING.line)) : files(c, next)));
  // A path that is no file is a client route, whatever it looks like: model ids carry dots
  // (/models/<connection>/vendor/model-4.5). Only a page load gets the page; a missing asset is a real 404.
  client.get('*', (c) => {
    const load = !c.req.path.startsWith('/assets/') && c.req.header('accept')?.includes('text/html');
    return load ? page(c) : c.notFound();
  });
  return client;
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
  const leader = board.ranking.chat.merged.find((row) => row.model !== null)?.model;
  return worded(html, leader ? `${PULSE_PAGE.title} · 대화 1위 ${leader}` : PULSE_PAGE.title, `최근 24시간 응답 ${count(board.replies)}번 · 최근 7일 ${count(board.people)}명이 썼어요`);
}
