import { createHash, randomBytes, randomUUID, type webcrypto } from 'node:crypto';

// Match browser HTTP costs with random proofs/wraps: server only hashes/stores them, never derives client keys.

export type Account = { id: string; username: string; cookie: string; timeline: string; rev: number };

type Init = { method?: string; body?: string | Uint8Array; account?: Account; timeoutMs?: number; type?: string };

const BATCH_ITEMS = 200;
const BATCH_BODY_BYTES = 3_600_000;

export class Hazelle {
  constructor(readonly base: string) {}

  async request(path: string, { method = 'GET', body, account, timeoutMs = 120_000, type }: Init = {}): Promise<Response> {
    // container.ts trusts the bridge as a proxy, so naming loopback keeps the signup and login limits (accounts.ts) off.
    const headers: Record<string, string> = { 'x-forwarded-for': '127.0.0.1' };
    if (body !== undefined) headers['content-type'] = type ?? (typeof body === 'string' ? 'application/json' : 'application/octet-stream');
    if (account) Object.assign(headers, { cookie: account.cookie, 'x-account': account.id });
    return fetch(`${this.base}/api/${path}`, { method, headers, body: body as RequestInit['body'], signal: AbortSignal.timeout(timeoutMs) });
  }

  async health(): Promise<boolean> {
    return this.request('health', { timeoutMs: 5_000 }).then((response) => response.ok, () => false);
  }

  signupRequest(id: string, username: string, timeoutMs?: number): Promise<Response> {
    const proof = () => randomBytes(32).toString('base64');
    const body = JSON.stringify({ accountId: id, username, passwordProof: proof(), recoveryProof: proof(), passwordWrap: proof(), recoveryWrap: proof() });
    return this.request('signup', { method: 'POST', timeoutMs, body });
  }

  // null: the signup was refused (cap, name taken).
  async signup(username: string): Promise<Account | null> {
    const id = randomUUID();
    const response = await this.signupRequest(id, username);
    if (response.status !== 201) {
      await response.body?.cancel();
      return null;
    }
    const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!;
    await response.body?.cancel();
    const account: Account = { id, username, cookie, timeline: '', rev: 0 };
    const page = (await (await this.request('objects?since=0', { account })).json()) as { timeline: string };
    account.timeline = page.timeline;
    return account;
  }

  async setService(operator: Account, caps: { signupCap: number; accountBytesCap: number | null; accountFileBytesCap: number | null }) {
    const response = await this.request('admin/service', { method: 'PUT', account: operator, body: JSON.stringify(caps) });
    if (response.status !== 204) throw new Error(`admin/service answered ${response.status}: ${await response.text()}`);
  }

  async batch(account: Account, bodies: string[]): Promise<Response> {
    const writes = bodies.map((body) => ({ id: randomUUID(), kind: 'message', parent: null, body, baseRev: null }));
    const response = await this.request('objects/batch', { method: 'POST', account, body: JSON.stringify({ timeline: account.timeline, writes, files: [] }) });
    if (response.ok) {
      const { revs } = (await response.clone().json()) as { revs: number[] };
      account.rev = Math.max(account.rev, ...revs);
    }
    return response;
  }

  // What a device's sync asks when it already holds everything: the account's store answers, with no rows.
  poll(account: Account): Promise<Response> {
    return this.request(`objects?since=${account.rev}&timeline=${account.timeline}`, { account });
  }

  async writeText(account: Account, bodies: Iterable<string>) {
    let pending: string[] = [];
    let size = 0;
    const flush = async () => {
      if (!pending.length) return;
      const response = await this.batch(account, pending);
      if (!response.ok) throw new Error(`batch for ${account.username} answered ${response.status}: ${await response.text()}`);
      pending = [];
      size = 0;
    };
    for (const body of bodies) {
      if (pending.length === BATCH_ITEMS || size + body.length > BATCH_BODY_BYTES) await flush();
      pending.push(body);
      size += body.length;
    }
    await flush();
  }

  // busy: how many times the server's upload slots were full and the upload waited out retryAfter.
  async upload(account: Account, bytes: Buffer): Promise<{ status: number; busy: number }> {
    const id = createHash('sha256').update(bytes).digest('hex');
    for (let busy = 0; ; busy++) {
      const response = await this.request(`files/${id}`, { method: 'PUT', account, body: bytes, timeoutMs: 300_000 });
      if (response.status !== 503) {
        await response.body?.cancel();
        return { status: response.status, busy };
      }
      const { retryAfter } = (await response.json()) as { retryAfter?: number };
      await new Promise((resolve) => setTimeout(resolve, (retryAfter ?? 5) * 1000));
    }
  }

  // A detached reply (POST /streams/<id>) read to its end, then dropped as the client drops it once saved. The end
  // frame is opened, so a reply that ended in a network failure is told from one that finished.
  async stream(account: Account, request: { url: string; body: string }, timeoutMs: number): Promise<StreamOutcome> {
    const id = randomUUID();
    const pair = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as webcrypto.CryptoKeyPair;
    const key = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
    const started = performance.now();
    const outcome: StreamOutcome = { status: 0, firstDataMs: null, ms: 0, bytes: 0, frames: 0, end: null, upstream: null };
    try {
      const response = await this.request(`streams/${id}`, {
        method: 'POST',
        account,
        timeoutMs,
        body: JSON.stringify({ key, request: { url: request.url, method: 'POST', headers: { 'content-type': 'application/json' }, body: request.body } }),
      });
      outcome.status = response.status;
      if (!response.ok || !response.body) {
        outcome.end = await response.text();
        return outcome;
      }
      let opening: Key | null = null;
      let buffer = Buffer.alloc(0);
      for await (const chunk of response.body) {
        outcome.bytes += chunk.byteLength;
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
          const length = buffer.readUInt32BE(0);
          const type = buffer[4]!;
          const seq = buffer.readUInt32BE(5);
          const body = buffer.subarray(9, 4 + length);
          buffer = buffer.subarray(4 + length);
          if (type === PING) continue;
          outcome.frames++;
          if (type === HELLO) opening = await openingKey(pair.privateKey, body, id);
          else if (type === DATA) outcome.firstDataMs ??= performance.now() - started;
          else if (type === HEAD) outcome.upstream = (JSON.parse(await open(opening!, type, seq, body)) as { status: number }).status;
          else if (type === END) outcome.end = (JSON.parse(await open(opening!, type, seq, body)) as { reason: string }).reason;
        }
      }
    } catch (error) {
      outcome.end = `client: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      outcome.ms = performance.now() - started;
      await this.request(`streams/${id}`, { method: 'DELETE', account }).then((response) => response.body?.cancel(), () => {});
    }
    return outcome;
  }
}

export type StreamOutcome = { status: number; firstDataMs: number | null; ms: number; bytes: number; frames: number; end: string | null; upstream: number | null };

// src/contracts/streams.ts and the sealing in src/server/stream-box.ts.
const HELLO = 0;
const HEAD = 1;
const DATA = 2;
const END = 3;
const PING = 4;
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
type Key = webcrypto.CryptoKey;

async function openingKey(own: Key, theirs: Uint8Array, id: string): Promise<Key> {
  const public_ = await crypto.subtle.importKey('raw', new Uint8Array(theirs), P256, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: public_ }, own, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const encode = (text: string) => new TextEncoder().encode(text);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encode(id), info: encode('risu-alpha stream') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

async function open(key: Key, type: number, seq: number, body: Uint8Array): Promise<string> {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setUint32(8, seq);
  return Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([type]) }, key, new Uint8Array(body))).toString();
}
