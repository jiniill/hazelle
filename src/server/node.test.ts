import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { createServer as httpServer, request } from 'node:http';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { BlockList, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VISITOR_HEADER } from '../contracts/http';
import { MAX_FILE_BYTES } from '../contracts/files';
import { sha256Hex } from './http';
import { pageCsp } from './static';
import { sessionCookie, signupBody } from './testing';

let dir: string;
let bundle: string;
let client: string;
const children: ChildProcess[] = [];
const pagePolicy = (page: Response) => pageCsp(/'nonce-([^']+)'/.exec(page.headers.get('content-security-policy') ?? '')?.[1] ?? '');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-node-'));
  // The bundle keeps undici external as build:server does, so it must sit where node_modules resolves.
  mkdirSync('node_modules/.cache', { recursive: true });
  bundle = join('node_modules', '.cache', `hazelle-node-${process.pid}`, 'node.js');
  client = join(dir, 'client');
  mkdirSync(client);
  writeFileSync(join(client, 'index.html'), 'page');
  buildSync({ entryPoints: ['src/server/node.ts', 'src/server/frontend-worker.ts', 'src/server/db/snapshot-worker.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', outdir: dirname(bundle), entryNames: '[name]', external: ['undici'], logLevel: 'silent' });
}, 60_000);
afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
  rmSync(dirname(bundle), { recursive: true, force: true });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

function start(dataDir: string, port: number, extra: Record<string, string> = {}, entry = bundle) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, HAZELLE_DATA: dataDir, PORT: String(port), HAZELLE_DRAIN_SECONDS: '2', HAZELLE_MIGRATIONS: 'migrations', HAZELLE_CLIENT: client, ...extra },
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout!.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const listening = new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = async () => {
      if (child.exitCode !== null) return reject(new Error(`exited early: ${out}`));
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() - started > 15_000) return reject(new Error(`never listened: ${out}`));
      setTimeout(poll, 100);
    };
    void poll();
  });
  // A process expected to exit never listens; its rejection is read only when a test awaits it.
  listening.catch(() => {});
  return { child, exited, listening, log: () => out };
}

describe('the server process', () => {
  it('enforces the shutdown deadline even when the frontend never acknowledges draining', async () => {
    const stalled = join(dirname(bundle), 'stalled');
    mkdirSync(stalled);
    copyFileSync(bundle, join(stalled, 'node.js'));
    writeFileSync(join(stalled, 'frontend-worker.js'), `
      import { parentPort } from 'node:worker_threads';
      parentPort.on('message', () => {});
      parentPort.postMessage('listening');
    `);
    const server = start(join(dir, 'data-stalled-drain'), 8080, { HAZELLE_DRAIN_SECONDS: '1' }, join(stalled, 'node.js'));
    await expect.poll(server.log, { timeout: 15000 }).toContain('"event":"listening"');
    server.child.kill('SIGTERM');
    await expect.poll(() => server.child.exitCode, { timeout: 4000 }).toBe(0);
    expect(server.log()).toContain('"event":"draining"');
    expect(server.log()).toContain('"drainMs":1000');
    expect(server.log()).toContain('"outcome":"timeout"');
  }, 20000);

  it('logs a proxy transport failure and its timing without credentials or request content', async () => {
    let received = 0;
    const api = httpServer((incoming) => {
      received++;
      incoming.socket.destroy();
    }).listen(0, '127.0.0.1');
    await once(api, 'listening');
    const port = await freePort();
    const frontend = new Worker(join(process.cwd(), dirname(bundle), 'frontend-worker.js'), {
      workerData: { port, apiPort: (api.address() as { port: number }).port, clientDir: client, trustedProxies: new BlockList() },
      stderr: true,
    });
    let log = '';
    frontend.stderr.on('data', (chunk: Buffer) => { log += chunk.toString(); });
    try {
      await once(frontend, 'message');
      const response = await fetch(`http://127.0.0.1:${port}/api/objects/batch?secret-query`, {
        method: 'POST', headers: { authorization: 'Bearer secret-token', cookie: 'secret-cookie' }, body: 'secret-body',
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'offline' });
      await expect.poll(() => log).toContain('proxy failed');
      const failure = JSON.parse(log.trim()) as Record<string, unknown>;
      expect(failure).toMatchObject({ event: 'proxy failed', method: 'POST', code: 'ECONNRESET', reusedSocket: false, headersSent: false });
      expect(failure.startedAt).toEqual(expect.any(Number));
      expect(failure.ms).toEqual(expect.any(Number));
      expect(failure.connectedMs).toEqual(expect.any(Number));
      expect(log).not.toContain('secret-');
      expect(received).toBe(1);
    } finally {
      await frontend.terminate();
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  }, 15_000);

  it('ends hop-by-hop headers at the proxy both ways, so a bodyless request with a Trailer is answered', async () => {
    const seen: Record<string, unknown>[] = [];
    const api = httpServer((incoming, outgoing) => {
      seen.push(incoming.headers);
      outgoing.writeHead(200, { connection: 'x-api-hop', 'x-api-hop': '1', 'keep-alive': 'timeout=5', 'proxy-authenticate': 'Basic', 'x-kept': '1' });
      outgoing.end('done');
    }).listen(0, '127.0.0.1');
    await once(api, 'listening');
    const port = await freePort();
    const frontend = new Worker(join(process.cwd(), dirname(bundle), 'frontend-worker.js'), {
      workerData: { port, apiPort: (api.address() as { port: number }).port, clientDir: client, trustedProxies: new BlockList() },
    });
    const send = (lines: string[]) =>
      new Promise<string>((resolve) => {
        const socket = connect(port, '127.0.0.1');
        let answer = '';
        socket.on('data', (chunk: Buffer) => (answer += chunk.toString()));
        socket.on('close', () => resolve(answer));
        socket.write([...lines, 'Connection: close', '', ''].join('\r\n'));
      });
    try {
      await once(frontend, 'message');
      const answer = await send(['GET /api/probe HTTP/1.1', 'Host: localhost', 'Trailer: X-Probe', 'TE: trailers', 'Keep-Alive: timeout=1', 'Proxy-Authorization: Basic x', 'Upgrade: h2c', 'Connection: x-client-hop', 'X-Client-Hop: 1']);
      expect(answer).toMatch(/^HTTP\/1\.1 200 /);
      expect(answer.toLowerCase()).not.toMatch(/x-api-hop|keep-alive|proxy-authenticate/);
      expect(answer.toLowerCase()).toContain('x-kept: 1');
      expect(Object.keys(seen[0]!).filter((name) => ['trailer', 'te', 'keep-alive', 'proxy-authorization', 'upgrade', 'x-client-hop'].includes(name))).toEqual([]);
      expect(await send(['GET /api/again HTTP/1.1', 'Host: localhost'])).toMatch(/^HTTP\/1\.1 200 /);
    } finally {
      await frontend.terminate();
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  }, 15_000);

  it('takes the visitor from X-Forwarded-For only when the connection comes from a trusted proxy', async () => {
    const visitors: unknown[] = [];
    const api = httpServer((incoming, outgoing) => {
      visitors.push(incoming.headers[VISITOR_HEADER]);
      outgoing.end('done');
    }).listen(0, '127.0.0.1');
    await once(api, 'listening');
    const loopback = new BlockList();
    loopback.addSubnet('127.0.0.0', 8, 'ipv4');
    for (const trustedProxies of [new BlockList(), loopback]) {
      const port = await freePort();
      const frontend = new Worker(join(process.cwd(), dirname(bundle), 'frontend-worker.js'), {
        workerData: { port, apiPort: (api.address() as { port: number }).port, clientDir: client, trustedProxies },
      });
      try {
        await once(frontend, 'message');
        await fetch(`http://127.0.0.1:${port}/api/probe`, { headers: { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' } });
      } finally {
        await frontend.terminate();
      }
    }
    await new Promise<void>((resolve) => api.close(() => resolve()));
    expect(visitors).toEqual(['::ffff:127.0.0.1', '203.0.113.9']);
  }, 15_000);

  it('retires idle proxy sockets before the API deadline without timing out an active response', async () => {
    let connections = 0;
    let closed = 0;
    const api = httpServer({ keepAliveTimeout: 2000, keepAliveTimeoutBuffer: 1000 }, (incoming, outgoing) => {
      if (incoming.url === '/api/slow') setTimeout(() => outgoing.end('done'), 1200);
      else outgoing.end('done');
    });
    api.on('connection', (socket) => {
      connections++;
      socket.on('close', () => { closed++; });
    });
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    const port = await freePort();
    const frontend = new Worker(join(process.cwd(), dirname(bundle), 'frontend-worker.js'), {
      workerData: { port, apiPort: (api.address() as { port: number }).port, clientDir: client, trustedProxies: new BlockList() },
    });
    const get = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, { signal: AbortSignal.timeout(5000) });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('done');
    };
    try {
      await once(frontend, 'message');
      await get('fast');
      await get('slow');
      expect(connections).toBe(1);
      // The hint is two seconds; Node's one-second client buffer retires it before the API's three-second close.
      await expect.poll(() => closed, { timeout: 1800, interval: 20 }).toBe(1);
      await get('fast');
      expect(connections).toBe(2);
    } finally {
      await frontend.terminate();
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  }, 15_000);

  it('serves the page while an API write waits on a database lock', async () => {
    const data = join(dir, 'data-blocked-api');
    const port = await freePort();
    const server = start(data, port);
    await server.listening;
    const origin = `http://127.0.0.1:${port}`;
    const account = await fetch(`${origin}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signupBody()) });
    const cookie = sessionCookie(account);
    const locked = new DatabaseSync(join(data, 'service.sqlite'));
    locked.exec('BEGIN IMMEDIATE');
    let finished = false;
    const logout = fetch(`${origin}/api/logout`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }).then((response) => { finished = true; return response; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const page = await fetch(origin, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(2_000) });
      expect(await page.text()).toBe('page');
      expect(page.headers.get('content-security-policy')).toBe(pagePolicy(page));
      expect(page.headers.get('server-timing')).toMatch(/^static;dur=/);
      expect(finished).toBe(false);
    } finally {
      locked.exec('ROLLBACK');
      locked.close();
    }
    const loggedOut = await logout;
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers.get('server-timing')).toMatch(/api_wait;dur=/);
    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
  }, 30_000);

  it('keeps the public listener alive when an upload is disconnected', async () => {
    const port = await freePort();
    const server = start(join(dir, 'data-disconnected'), port);
    await server.listening;
    const sending = request({ host: '127.0.0.1', port, path: '/api/signup', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 } });
    sending.on('error', () => {});
    sending.write('{');
    await new Promise((resolve) => setTimeout(resolve, 50));
    sending.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
  }, 30_000);

  it('starts on an empty directory, migrates, answers health and session, and refuses a second process on the directory', async () => {
    const data = join(dir, 'data');
    const port = await freePort();
    const server = start(data, port);
    await server.listening;
    expect(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).toEqual({ ok: true, liveCalls: 0, backupAgeHours: null, diskFreePercent: expect.any(Number) });
    expect(await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).toEqual({ session: null, door: { kind: 'setup' } });
    const unknown = await fetch(`http://127.0.0.1:${port}/api/nowhere`, { headers: { accept: 'text/html' } });
    expect([unknown.status, unknown.headers.get('content-security-policy')]).toEqual([404, null]);
    const page = await fetch(`http://127.0.0.1:${port}/models/c1/vendor/model-4.5`, { headers: { accept: 'text/html' } });
    expect([page.status, page.headers.get('content-security-policy'), await page.text()]).toEqual([200, pagePolicy(page), 'page']);
    expect(server.log()).toContain(`"migrationsApplied":${JSON.stringify(readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort())}`);

    const second = start(data, await freePort());
    expect(await second.exited).toBe(1);
    expect(second.log()).toContain('another process holds');

    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(server.log()).toContain('"event":"stopped"');
  }, 30_000);

  it('takes a variable left empty as its default, refuses one that is no number, and captures a generation on SIGUSR2 without stopping', async () => {
    const refused = start(join(dir, 'data-bad-env'), await freePort(), { HAZELLE_SNAPSHOT_HOUR: '24' });
    expect(await refused.exited).toBe(1);
    expect(refused.log()).toContain('HAZELLE_SNAPSHOT_HOUR must be a whole number from 0 to 23');
    const untrusted = start(join(dir, 'data-bad-proxies'), await freePort(), { HAZELLE_TRUSTED_PROXIES: '172.30.0.0/24, 172.30.0.0/' });
    expect(await untrusted.exited).toBe(1);
    expect(untrusted.log()).toContain('HAZELLE_TRUSTED_PROXIES must list addresses or CIDR ranges: 172.30.0.0/');

    const data = join(dir, 'data-signal');
    const port = await freePort();
    // An empty drain would be zero seconds: the SIGTERM below must still report a drain, not a timeout at once.
    const server = start(data, port, { HAZELLE_SNAPSHOT_HOUR: '', HAZELLE_DRAIN_SECONDS: '' });
    await server.listening;
    server.child.kill('SIGUSR2');
    const captured = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        // The handler makes backup/ itself, after the baselines: on a slow machine it may not exist yet.
        const made = !existsSync(join(data, 'backup')) ? [] : readdirSync(join(data, 'backup'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== 'files');
        if (made.some((entry) => readdirSync(join(data, 'backup', entry.name)).includes('manifest.json'))) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await captured(), server.log()).toBe(true);
    // The line follows the manifest by the listing the handler makes for the id.
    for (let attempt = 0; attempt < 100 && !server.log().includes('backup finished'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.log()).toMatch(/"event":"backup finished","snapshots":"ok","generation":"ok","id":"\d+-/);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(server.log()).toMatch(/"drainMs":60000/);
  }, 30_000);

  it('answers the request in flight on SIGTERM, refuses new connections, and exits 0 once drained', async () => {
    const data = join(dir, 'data-drain');
    const port = await freePort();
    const server = start(data, port);
    await server.listening;
    // A request in flight when the signal comes: its body arrives after the drain began.
    const slow = new Promise<number>((resolve, reject) => {
      const sending = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/session', headers: { 'content-type': 'application/json', 'content-length': 2 } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode!));
      });
      sending.on('error', reject);
      setTimeout(() => sending.end('{}'), 300);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.child.kill('SIGTERM');
    // Until the signal is handled the server still answers 200; on a slow runner that takes longer than a fetch.
    for (let attempt = 0; attempt < 100 && !server.log().includes('"event":"draining"'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    // server.close drops idle connections and refuses new ones at once, so health's 503 is for a request already on
    // the wire; a new connection during the drain is refused.
    let refused = false;
    for (let attempt = 0; attempt < 20 && !refused && server.child.exitCode === null; attempt++) {
      await fetch(`http://127.0.0.1:${port}/api/health`).then(
        (response) => expect(response.status).toBe(503),
        () => (refused = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await slow).toBe(404);
    expect(await server.exited).toBe(0);
    expect(refused).toBe(true);
    expect(server.log()).toMatch(/"outcome":"drained"/);
  }, 30_000);

  it('finishes a 25 MiB upload signalled while its body arrives or while its bytes are written, with one charge and no temp file after a restart', async () => {
    const data = join(dir, 'data-upload');
    let port = await freePort();
    let server = start(data, port);
    await server.listening;
    const body = signupBody();
    const cookie = sessionCookie(await fetch(`http://127.0.0.1:${port}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const service = new DatabaseSync(join(data, 'service.sqlite'), { readOnly: true });
    const incarnation = service.prepare('SELECT incarnation FROM accounts WHERE id = ?').get(body.accountId)!.incarnation as string;
    service.close();
    const pictures = join(data, 'files', incarnation);
    const pictureOf = () => {
      const bytes = randomBytes(MAX_FILE_BYTES);
      return { bytes, id: sha256Hex(bytes) };
    };
    // Sent as a browser sends a picture: with its length, here in 1 MiB pieces, `afterPiece` called after each.
    const upload = (picture: ReturnType<typeof pictureOf>, afterPiece: (piece: number) => Promise<void>) =>
      new Promise<number>((resolve, reject) => {
        const sending = request(
          {
            host: '127.0.0.1',
            port,
            method: 'PUT',
            path: `/api/files/${picture.id}`,
            headers: { cookie, 'x-account': body.accountId, 'content-type': 'application/octet-stream', 'content-length': picture.bytes.length },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode!));
          },
        );
        sending.on('error', reject);
        void (async () => {
          const piece = 1024 * 1024;
          for (let at = 0; at < picture.bytes.length; at += piece) {
            sending.write(picture.bytes.subarray(at, at + piece));
            await afterPiece(at / piece);
          }
          sending.end();
        })();
      });

    const receiving = pictureOf();
    const receivingStatus = upload(receiving, async (piece) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (piece === 4) server.child.kill('SIGTERM');
    });
    expect(await receivingStatus).toBe(204);
    expect(await server.exited).toBe(0);
    expect(server.log()).toMatch(/"outcome":"drained"/);

    port = await freePort();
    server = start(data, port);
    await server.listening;
    const publishing = pictureOf();
    let signalled = false;
    const watching = watch(pictures, (_, name) => {
      if (signalled || !name?.startsWith('.tmp-')) return;
      signalled = true;
      server.child.kill('SIGTERM');
    });
    try {
      expect(await upload(publishing, async () => {})).toBe(204);
    } finally {
      watching.close();
    }
    expect(signalled).toBe(true);
    expect(await server.exited).toBe(0);
    expect(server.log()).toMatch(/"outcome":"drained"/);

    port = await freePort();
    server = start(data, port);
    await server.listening;
    expect(await upload(receiving, async () => {})).toBe(204);
    for (const { id } of [receiving, publishing]) {
      const read = await fetch(`http://127.0.0.1:${port}/api/files/${id}`, { headers: { cookie, 'x-account': body.accountId } });
      expect(sha256Hex(new Uint8Array(await read.arrayBuffer()))).toBe(id);
    }
    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    const after = new DatabaseSync(join(data, 'service.sqlite'), { readOnly: true });
    expect(after.prepare('SELECT file_bytes FROM accounts WHERE incarnation = ?').get(incarnation)).toEqual({ file_bytes: 2 * MAX_FILE_BYTES });
    expect(after.prepare('SELECT id, size, stored FROM account_files WHERE incarnation = ? ORDER BY id').all(incarnation)).toEqual(
      [receiving.id, publishing.id].sort().map((id) => ({ id, size: MAX_FILE_BYTES, stored: 1 })),
    );
    after.close();
    expect(readdirSync(pictures).sort()).toEqual([receiving.id, publishing.id].sort());
  }, 30_000);
});
