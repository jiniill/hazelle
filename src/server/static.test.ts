import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PulseAnswer, PulseBoard } from '../contracts/pulse';
import { clientFiles, CSP, pageCsp, SANDBOX_CSP, SANDBOX_NETWORK_CSP } from './static';

let dir: string;
let client: ReturnType<typeof clientFiles>;
let pulse: () => Promise<PulseAnswer>;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-client-'));
  mkdirSync(join(dir, 'assets'));
  for (const [name, body] of [
    ['index.html', '<!doctype html>page'],
    ['sandbox.html', readFileSync('sandbox.html', 'utf8')],
    ['assets/main-h1.js', 'main'],
    ['assets/evaluation-worker-h2.js', 'worker'],
    ['assets/tokenizer-h3.wasm', 'wasm'],
    ['license.txt', 'license'],
    ['source.tar.gz', 'source'],
  ]) {
    writeFileSync(join(dir, name!), body!);
  }
  client = clientFiles(dir, async (share) => (share === 'covered-share-id' ? { name: 'Mira <b>', creator: 'jin & co', line: '$& "quoted"' } : null), () => pulse());
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PAGE = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };
const ANY = { accept: '*/*' };
const nonceOf = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? '')?.[1] ?? '';
const pagePolicy = (response: Response) => pageCsp(nonceOf(response.headers.get('content-security-policy')));

describe('the client files', () => {
  it('serves hashed assets as immutable with their types, other files and the page as no-cache, all under the CSP', async () => {
    const cases: [path: string, type: string, cache: string, body: string][] = [
      ['/assets/main-h1.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable', 'main'],
      ['/assets/evaluation-worker-h2.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable', 'worker'],
      ['/assets/tokenizer-h3.wasm', 'application/wasm', 'public, max-age=31536000, immutable', 'wasm'],
      ['/license.txt', 'text/plain; charset=utf-8', 'no-cache', 'license'],
      ['/source.tar.gz', 'application/gzip', 'no-cache', 'source'],
      ['/', 'text/html; charset=UTF-8', 'no-cache', '<!doctype html>page'],
    ];
    for (const [path, type, cache, body] of cases) {
      const response = await client.request(path, { headers: ANY });
      expect([path, response.status, response.headers.get('content-type'), response.headers.get('cache-control'), await response.text()]).toEqual([path, 200, type, cache, body]);
      expect(response.headers.get('content-security-policy')).toBe(path === '/' ? pagePolicy(response) : CSP);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('access-control-allow-origin')).toBe(path.startsWith('/assets/') ? '*' : null);
    }
  });

  it('answers a page load of any path that is no file with the page, dotted model routes included', async () => {
    for (const path of ['/terms', '/privacy', '/models/c1/vendor/model-4.5', '/chats/abc']) {
      const response = await client.request(path, { headers: PAGE });
      expect([path, response.status, response.headers.get('cache-control'), await response.text()]).toEqual([path, 200, 'no-cache', '<!doctype html>page']);
      expect(response.headers.get('content-security-policy')).toBe(pagePolicy(response));
    }
  });

  it('words the guest home for search engines and keeps every page but the public four out of the index', async () => {
    pulse = async () => ({ at: 0, board: null });
    writeFileSync(join(dir, 'index.html'), '<title>헤이젤</title><meta name="description" content="app" /></head><div id="root"><p class="boot" role="status">불러오는 중…</p></div>');
    const home = await (await client.request('/', { headers: PAGE })).text();
    expect(home).toContain('<title>헤이젤 · RisuAI 대체 캐릭터 챗, 설치 없이 웹에서</title>');
    expect(home).toContain('<link rel="canonical" href="https://hazelle.app/" />');
    expect(home).toContain('<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication"');
    expect(home).toMatch(/<div id="root"><main class="boot landing"><h1>RisuAI 대체 캐릭터 챗, 헤이젤<\/h1>.*<p role="status">불러오는 중…<\/p><\/main><\/div>$/);
    for (const path of ['/', '/now', '/terms', '/privacy', '/board', '/s/no-cover-share00', '/index.html']) {
      const response = await client.request(path, { headers: PAGE });
      const hidden = ['/board', '/s/no-cover-share00', '/index.html'].includes(path);
      expect([path, response.headers.get('x-robots-tag'), (await response.text()).includes(`<link rel="canonical" href="https://hazelle.app${path}" />`)]).toEqual([path, hidden ? 'noindex' : null, !hidden]);
    }
    expect(await (await client.request('/index.html', { headers: PAGE })).text()).not.toContain('landing');
    writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  });

  it('lists the public four in the sitemap and points robots.txt at it', async () => {
    expect(await (await client.request('/sitemap.xml')).text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://hazelle.app/</loc></url><url><loc>https://hazelle.app/now</loc></url><url><loc>https://hazelle.app/terms</loc></url><url><loc>https://hazelle.app/privacy</loc></url></urlset>\n',
    );
    expect(await (await client.request('/robots.txt')).text()).toBe('User-agent: *\nDisallow: /api/\nSitemap: https://hazelle.app/sitemap.xml\n');
  });

  it("marks a self-host's page for the client and keeps all of it out of the index", async () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="ko">page</html>');
    const own = clientFiles(dir, async () => null, async () => ({ at: 0, board: null }), () => {}, true);
    for (const path of ['/', '/now', '/terms']) {
      const response = await own.request(path, { headers: PAGE });
      expect([path, response.headers.get('x-robots-tag'), await response.text()]).toEqual([path, 'noindex', expect.stringContaining('<html data-self-host lang="ko">')]);
    }
    expect([(await own.request('/sitemap.xml')).status, await (await own.request('/robots.txt')).text()]).toEqual([404, 'User-agent: *\nDisallow: /api/\n']);
    expect(await (await client.request('/', { headers: PAGE })).text()).not.toContain('data-self-host');
    writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  });

  it("fills a share page's embed with its escaped cover text, and never with a picture", async () => {
    writeFileSync(join(dir, 'index.html'), '<title>헤이젤</title><meta name="description" content="app" /><meta property="og:title" content="헤이젤" /><meta property="og:description" content="app" /><meta property="og:image" content="https://hazelle.app/og.png" /><meta name="twitter:card" content="summary_large_image" />');
    const covered = await (await client.request('/s/covered-share-id', { headers: PAGE })).text();
    expect(covered).toBe('<title>Mira &#60;b&#62; · jin &#38; co</title><meta name="description" content="$&#38; &#34;quoted&#34;" /><meta property="og:title" content="Mira &#60;b&#62; · jin &#38; co" /><meta property="og:description" content="$&#38; &#34;quoted&#34;" /><meta name="twitter:card" content="summary" />');
    const bare = await client.request('/s/no-cover-share00', { headers: PAGE });
    expect([bare.headers.get('content-security-policy'), await bare.text()]).toEqual([pagePolicy(bare), '<title>헤이젤</title><meta name="description" content="app" /><meta property="og:title" content="헤이젤" /><meta property="og:description" content="app" /><meta name="twitter:card" content="summary" />']);
    writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  });

  it("fills 헤이젤 나우's embed with the board's escaped numbers and its first named 대화 model, keeping the picture", async () => {
    const html = '<title>헤이젤</title><meta name="description" content="app" /><meta property="og:title" content="헤이젤" /><meta property="og:description" content="app" /><meta property="og:image" content="https://hazelle.app/og.png" />';
    writeFileSync(join(dir, 'index.html'), html);
    const row = (model: string | null) => ({ key: model ?? '', model, share: 0.5, people: 5 });
    const board = { people: 4560, replies: 12340, ranking: { chat: { merged: [row(null), row('GPT <5> & "co"')], split: [] } } } as unknown as PulseBoard;
    pulse = async () => ({ at: 0, board });
    const page = async () => (await client.request('/now', { headers: PAGE })).text();
    expect(await page()).toBe(
      '<title>헤이젤 나우 · 대화 1위 GPT &#60;5&#62; &#38; &#34;co&#34;</title><meta name="description" content="최근 24시간 응답 12,340번 · 최근 7일 4,560명이 썼어요" /><meta property="og:title" content="헤이젤 나우 · 대화 1위 GPT &#60;5&#62; &#38; &#34;co&#34;" /><meta property="og:description" content="최근 24시간 응답 12,340번 · 최근 7일 4,560명이 썼어요" /><meta property="og:image" content="https://hazelle.app/og.png" />',
    );
    for (const answer of [() => Promise.resolve({ at: 0, board: null }), () => Promise.reject(new Error('down'))]) {
      pulse = answer;
      expect(await page()).toBe(html);
    }
    writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  });

  it("gives each page load its own nonce, in the page where Vite left the placeholder and in the page's policy", async () => {
    writeFileSync(join(dir, 'index.html'), '<meta property="csp-nonce" nonce="HAZELLE_NONCE">');
    const loads = await Promise.all(['/', '/chats/abc'].map((path) => client.request(path, { headers: PAGE })));
    const nonces = loads.map((load) => nonceOf(load.headers.get('content-security-policy')));
    expect(await Promise.all(loads.map((load) => load.text()))).toEqual(nonces.map((nonce) => `<meta property="csp-nonce" nonce="${nonce}">`));
    expect(nonces[0]).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(nonces[0]).not.toBe(nonces[1]);
    writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  });

  it('answers a real 404 for a missing asset even on a page load, and for a missing file nobody loads as a page', async () => {
    for (const [path, headers] of [
      ['/assets/gone-h9.js', PAGE],
      ['/assets/gone-h9.js', ANY],
      ['/favicon.ico', { accept: 'image/avif,image/webp,*/*;q=0.8' }],
    ] as const) {
      const response = await client.request(path, { headers });
      expect([path, response.status, response.headers.get('cache-control')]).toEqual([path, 404, null]);
      expect(response.headers.get('content-security-policy')).toBe(CSP);
    }
  });
});


it('serves the opaque tool document with a classic script and its own CSP, never the app policy', async () => {
  const response = await client.request('/sandbox.html?role=background', { headers: PAGE });
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toBe(SANDBOX_CSP);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('cache-control')).toBe('no-cache');
  expect(html).toContain('<script src="/sandbox/host.js"></script>');
  expect(html).not.toMatch(/type\s*=\s*['"]module['"]/i);
  expect(SANDBOX_CSP).toContain('sandbox allow-scripts allow-downloads allow-modals;');
  expect(SANDBOX_CSP).toContain("connect-src 'none'");
  expect(SANDBOX_CSP).toContain("frame-src 'none'");
  expect(CSP).toContain("frame-src 'self'");
  expect(CSP).not.toContain('sandbox allow-scripts');
  const app = await client.request('/', { headers: PAGE });
  expect(app.headers.get('content-security-policy')).toBe(pagePolicy(app));
});

it('serves a frame with network consent pictures, fonts and stylesheets from outside, and never a connection', async () => {
  const policy = async (query: string) => (await client.request(`/sandbox.html?${query}`, { headers: PAGE })).headers.get('content-security-policy');
  const wide = await policy('role=frame&network=1');
  expect(wide).toBe(SANDBOX_NETWORK_CSP);
  expect(wide).toContain('img-src data: blob: https:;');
  expect(wide).toContain("font-src 'self' data: https:;");
  expect(wide).toContain("connect-src 'none'");
  expect(wide).toContain("frame-ancestors 'self'");
  for (const query of ['role=frame', 'role=frame&network=yes', 'role=page']) expect(await policy(query)).toBe(SANDBOX_CSP);
  expect(SANDBOX_CSP).not.toContain('https:');
});

it('allows guest provider HTTPS fetches in the app while both tool frame policies keep the network closed', async () => {
  const connects = (response: Response) => /(?:^|;)\s*connect-src ([^;]+)/.exec(response.headers.get('content-security-policy') ?? '')?.[1];
  expect(connects(await client.request('/', { headers: PAGE }))).toBe("'self' https:");
  for (const path of ['/sandbox.html', '/sandbox.html?network=1']) expect(connects(await client.request(path, { headers: PAGE }))).toBe("'none'");
});
