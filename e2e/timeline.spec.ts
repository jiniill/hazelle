import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { build, type Rollup } from 'vite';
import { fileURLToPath } from 'node:url';
import { GENERATION_STEPS } from '../src/runtime/testing/cache';
import { CARD, confirmImport, pickBot, settingsPage, signUpAsGuest } from './helpers';

// FakeServer controls restore between exact requests and matches object API semantics.
// Tabs share one context/IndexedDB, as real tabs do.

type Row = { id: string; kind: string; parent: string | null; rev: number; body: string | null };
type Snapshot = { rows: Map<string, Row>; rev: number };
type Write = Omit<Row, 'rev'> & { baseRev: number | null };
const LIMITS = { items: 100, bytes: 4_000_000, body: 1_500_000 };
const PASSWORD = 'e2e-password';

class FakeServer {
  timeline = 't0';
  offline = false;
  // Every write the server took, with the timeline it took it on.
  readonly taken: { timeline: string; kind: string }[] = [];
  readonly refused: string[] = [];
  private rev = 0;
  private rows = new Map<string, Row>();
  private readonly files = new Map<string, Buffer>();
  private account: { accountId: string; username: string; vault: { passwordWrap: string; recoveryWrap: string } } | null = null;
  private readonly holds = new Map<Page, { match: (url: URL) => boolean; held: (() => void)[] }>();
  private readonly asked = new Map<Page, number>();

  // Until a page has asked nothing for a second: a tab still settling after it opened would hear another tab's cache
  // change on its own.
  async quiet(page: Page) {
    for (let last = -1, tries = 0; last !== (this.asked.get(page) ?? 0); tries++) {
      if (tries === 15) throw new Error('The page kept asking');
      last = this.asked.get(page) ?? 0;
      await page.waitForTimeout(1000);
    }
  }

  snapshot(): Snapshot {
    return { rows: new Map(this.rows), rev: this.rev };
  }

  // What a restore or its undo does to the account's store: its rows and head go back, under a new timeline.
  restore(to: Snapshot, timeline: string) {
    this.rows = new Map(to.rows);
    this.rev = to.rev;
    this.timeline = timeline;
  }

  ids(): string[] {
    return [...this.rows.keys()].toSorted();
  }

  // A page's matching requests are answered as the server saw them when they came, but only once released.
  hold(page: Page, match: (url: URL) => boolean) {
    this.holds.set(page, { match, held: [] });
  }

  held(page: Page): number {
    return this.holds.get(page)?.held.length ?? 0;
  }

  release(page: Page) {
    for (const go of this.holds.get(page)?.held ?? []) go();
    this.holds.delete(page);
  }

  async handle(route: Route) {
    if (this.offline) return route.abort('internetdisconnected');
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice('/api/'.length);
    const answer = this.answer(request.method(), path, url, request.postDataBuffer());
    const page = request.frame().page();
    this.asked.set(page, (this.asked.get(page) ?? 0) + 1);
    const hold = this.holds.get(page);
    if (hold?.match(url)) await new Promise<void>((resolve) => hold.held.push(resolve));
    await route.fulfill(answer);
  }

  private answer(method: string, path: string, url: URL, body: Buffer | null): { status: number; json?: unknown; body?: Buffer; headers?: Record<string, string> } {
    const json = () => JSON.parse(body!.toString()) as Record<string, unknown>;
    const stored = { 'x-account-bytes': String([...this.rows.values()].reduce((sum, row) => sum + (row.body?.length ?? 0), 0)) };
    if (path === 'session' && method === 'GET') return { status: 200, json: this.account ? { session: this.facts(), vault: this.account.vault } : { session: null, door: { kind: 'open' } } };
    if (path === 'signup' && method === 'POST') {
      const { accountId, username, passwordWrap, recoveryWrap } = json() as Record<string, string>;
      this.account = { accountId: accountId!, username: username!, vault: { passwordWrap: passwordWrap!, recoveryWrap: recoveryWrap! } };
      return { status: 200, json: this.facts() };
    }
    if (path === 'objects' && method === 'GET') {
      const since = Number(url.searchParams.get('since'));
      const known = Number(url.searchParams.get('known'));
      const sent = url.searchParams.get('timeline');
      // A request with no timeline is taken only as a bootstrap from nothing (tech-spec §5).
      if (sent === null ? since !== 0 || known !== 0 : sent !== this.timeline) return this.reset(`feed ${sent}`);
      if (Math.max(since, known) > this.rev) return this.reset('feed past the head');
      const parent = url.searchParams.get('parent');
      const bootstrap = url.searchParams.has('bootstrap');
      const until = Number(url.searchParams.get('until') ?? this.rev);
      const excluded = (url.searchParams.get('exclude') ?? '').split(',');
      const metadata = url.searchParams.has('metadata');
      const changes = [...this.rows.values()]
        .filter((row) => row.rev > since && (parent === null || row.parent === parent) && (!bootstrap || (row.rev <= until && !excluded.includes(row.kind))))
        .sort((a, b) => a.rev - b.rev)
        .map(({ body: sealed, ...row }) => (sealed !== null && (metadata || excluded.includes(row.kind)) ? { ...row, omitted: true } : { ...row, body: sealed }));
      return { status: 200, headers: stored, json: { timeline: this.timeline, changes, cursor: changes.at(-1)?.rev ?? since, more: false, limits: LIMITS, ...(bootstrap && { until }) } };
    }
    if (path === 'objects/batch' && method === 'POST') {
      const { timeline, writes } = json() as { timeline: string; writes: Write[] };
      if (timeline !== this.timeline) return this.reset(`batch ${timeline}`);
      if (writes.some((write) => (this.rows.get(write.id)?.rev ?? null) !== write.baseRev)) return { status: 409, json: { error: 'conflict' } };
      const revs = writes.map(({ id, kind, parent, body: sealed }) => {
        this.rows.set(id, { id, kind, parent, body: sealed, rev: ++this.rev });
        this.taken.push({ timeline, kind });
        return this.rev;
      });
      return { status: 200, headers: stored, json: { revs, timeline } };
    }
    if (path === 'files/missing' && method === 'POST') return { status: 200, json: { missing: (json().ids as string[]).filter((id) => !this.files.has(id)), room: null } };
    if (path.startsWith('files/') && method === 'PUT') {
      this.files.set(path.slice('files/'.length), body!);
      return { status: 204 };
    }
    if (path.startsWith('files/') && method === 'GET') {
      const bytes = this.files.get(path.slice('files/'.length));
      return bytes ? { status: 200, body: bytes, headers: { 'content-type': 'application/octet-stream' } } : { status: 404, json: { error: 'not-found' } };
    }
    return { status: 404, json: { error: 'not-found' } };
  }

  private reset(why: string) {
    this.refused.push(why);
    return { status: 409, json: { error: 'cache-reset' } };
  }

  private facts() {
    const { accountId, username } = this.account!;
    return { accountId, username, admin: false, suspended: false, state: 'active', storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null } };
  }
}

async function served(context: BrowserContext): Promise<FakeServer> {
  const server = new FakeServer();
  await context.route('**/api/**', (route) => server.handle(route));
  return server;
}

async function signUp(page: Page) {
  await page.goto('/');
  await signUpAsGuest(page, 'e2e', PASSWORD);
  await expect(empty(page)).toBeVisible();
}

async function importCard(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await pickBot(page);
  await page.getByRole('button', { name: '확인했어요', exact: true }).click();
  await (await chooser).setFiles(CARD);
  await confirmImport(page);
  await page.keyboard.press('Escape');
  await expect(mira(page)).toBeVisible();
}

const empty = (page: Page) => page.getByRole('heading', { name: '비어 있어요', exact: true });
const mira = (page: Page) => page.getByText('Mira', { exact: true }).first();
// keepSynced pulls when the window gains focus. Page code is passed as text: e2e/ compiles without the DOM types.
const focus = (page: Page) => page.evaluate("window.dispatchEvent(new Event('focus'))");

// The tab's cache as IndexedDB holds it: the account's generations' timelines and the ids of its rows.
const cacheOf = (page: Page) =>
  page.evaluate<{ timelines: (string | null)[]; ids: string[] }>(`new Promise((resolve, reject) => {
    const opening = indexedDB.open('risu-alpha-objects');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(['generations', 'objects']);
      const generations = tx.objectStore('generations').getAll();
      const rows = tx.objectStore('objects').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve({ timelines: generations.result.map(({ timeline }) => timeline), ids: rows.result.map(({ id }) => id).toSorted() });
      };
    };
  })`);

test('the browser cache keeps the generation rules MemoryCache keeps, on real IndexedDB', async ({ page }) => {
  await served(page.context());
  await page.goto('/');
  const source = (path: string) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
  const entry = `import { deviceCache } from ${source('../src/runtime/device-cache.ts')}; import { generationSteps } from ${source('../src/runtime/testing/cache.ts')}; Object.assign(window, { steps: () => generationSteps(deviceCache('contract')) });`;
  const bundled = (await build({
    configFile: false,
    logLevel: 'silent',
    // Vite resolves a library entry against its root before any plugin sees it.
    plugins: [{ name: 'steps', resolveId: (id) => (id.endsWith('/steps') ? '\0steps' : null), load: (id) => (id === '\0steps' ? entry : null) }],
    build: { write: false, lib: { entry: 'steps', formats: ['iife'], name: 'steps' } },
  })) as Rollup.RollupOutput[];
  await page.evaluate(bundled[0]!.output[0].code);
  expect(await page.evaluate<string[]>('steps()')).toEqual(GENERATION_STEPS);
});

test('two tabs across a restore and its undo end on the undo’s timeline with its rows; a stale tab’s delayed clear and bootstrap change nothing', async ({ context }) => {
  const server = await served(context);
  const first = await context.newPage();
  await signUp(first);
  const before = server.snapshot();
  await importCard(first);
  const second = await context.newPage();
  await second.goto('/');
  await expect(mira(second)).toBeVisible();
  await server.quiet(second);
  await server.quiet(first);
  const checkpoint = server.snapshot();

  await test.step('restore: the first tab hears it, clears the cache and asks for its bootstrap, whose answer is held', async () => {
    server.restore(before, 't1');
    server.hold(first, (url) => url.pathname === '/api/objects' && !url.searchParams.has('timeline'));
    await focus(first);
    await expect.poll(() => server.held(first)).toBe(1);
    await expect.poll(async () => (await cacheOf(first)).timelines).toEqual([null]);
  });

  await test.step('undo: the second tab’s clear is a stale tab’s and changes nothing; it joins the cleared generation and bootstraps the undo', async () => {
    server.restore(checkpoint, 't2');
    await focus(second);
    await expect.poll(async () => (await cacheOf(second)).timelines).toEqual(['t2']);
    await expect(mira(second)).toBeVisible();
  });

  await test.step('the first tab’s delayed bootstrap of the restore changes nothing, and the tab reloads the undo from the cache', async () => {
    server.release(first);
    await expect(mira(first)).toBeVisible();
    await expect(second.getByText('계정을 복원해서 다시 열었어요')).toBeVisible();
    await expect(first.getByText('계정을 복원해서 다시 열었어요')).toBeVisible();
  });

  await test.step('both tabs pull again with no further reset; the cache holds the undo’s timeline and the server’s rows', async () => {
    const refused = server.refused.length;
    await focus(first);
    await focus(second);
    await expect.poll(async () => (await cacheOf(first)).ids).toEqual(server.ids());
    expect((await cacheOf(first)).timelines).toEqual(['t2']);
    await first.waitForTimeout(500);
    expect(server.refused.length).toBe(refused);
    await expect(mira(first)).toBeVisible();
    await expect(mira(second)).toBeVisible();
  });
});

test('two tabs across a restore: a tab whose reset arrives late clears nothing and loads the restored rows', async ({ context }) => {
  const server = await served(context);
  const first = await context.newPage();
  await signUp(first);
  const before = server.snapshot();
  await importCard(first);
  const second = await context.newPage();
  await second.goto('/');
  await expect(mira(second)).toBeVisible();

  server.restore(before, 't1');
  server.hold(second, (url) => url.pathname === '/api/objects');
  await focus(second);
  await expect.poll(() => server.held(second)).toBe(1);
  await focus(first);
  await expect(empty(first)).toBeVisible();
  await expect.poll(async () => (await cacheOf(first)).timelines).toEqual(['t1']);
  await expect.poll(async () => (await cacheOf(first)).ids).toEqual(server.ids());
  server.release(second);
  await expect(empty(second)).toBeVisible();
  expect((await cacheOf(second)).timelines).toEqual(['t1']);
  expect((await cacheOf(second)).ids).toEqual(server.ids());
});

test('an edit made offline across a restore is dropped and counted when the tab is back', async ({ page }) => {
  const server = await served(page.context());
  await signUp(page);
  await page.keyboard.press('Control+,');
  await settingsPage(page, '페르소나');
  await page.getByRole('button', { name: /^손님/ }).click();
  const alias = page.getByLabel('별명', { exact: true });
  await expect(alias).toHaveValue('');

  server.offline = true;
  const restorePoint = server.snapshot();
  await alias.fill('offline-edit');
  await expect(page.getByText('연결이 불안정해요')).toBeVisible();
  server.restore(restorePoint, 't1');
  server.offline = false;

  await expect(page.getByText('계정을 복원해서 다시 열었어요')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('방금 바꾼 내용 1개는 저장되지 않았어요')).toBeVisible();
  // The persona is shown again as the restore left it.
  await expect(alias).toHaveValue('');
  await page.waitForTimeout(1000);
  expect(server.taken.filter(({ timeline, kind }) => timeline === 't1' && kind === 'persona')).toEqual([]);
});

test('a restore between the two scans of a backup export ends it with its session and writes no archive', async ({ page }) => {
  const server = await served(page.context());
  // The fallback download, so no native picker opens; a finished export would download through it.
  await page.addInitScript('delete window.showSaveFilePicker');
  await signUp(page);
  await importCard(page);
  const downloads: unknown[] = [];
  page.on('download', (download) => downloads.push(download));
  // The metadata scan is answered on the old timeline, and the body scan is asked on the new one.
  server.hold(page, (url) => url.pathname === '/api/objects' && url.searchParams.has('metadata') && !url.searchParams.has('parent'));
  await page.keyboard.press('Control+,');
  await settingsPage(page, '계정');
  await page.getByRole('group', { name: '전체 백업' }).getByRole('button', { name: '내보내기', exact: true }).click();
  await expect.poll(() => server.held(page)).toBe(1);
  server.restore(server.snapshot(), 't1');
  server.release(page);
  await expect(page.getByText('계정을 복원해서 다시 열었어요')).toBeVisible();
  await page.waitForTimeout(500);
  expect(downloads).toEqual([]);
});
