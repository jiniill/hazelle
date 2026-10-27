import { RELAY_HEADER, type ServerError } from '../contracts/http';
import { HELLO, HEAD, DATA, END, PING, WAIT, retryWait, type Retry } from '../contracts/streams';
import { isRecord } from './http';
import type { RelayAllowance } from './limits';
import { forward, RelayTrafficLimit, type Upstream } from './relay';

// A stream that closes with no end frame was lost: the process restarted with the call gone.
type Reason = { reason: 'done' | 'stopped' | 'limit' } | { reason: 'network'; detail: string };

// One stream's rows in streams.sqlite (streams-db.ts).
export type BoxStorage = {
  // hello and the stream's alarm in one transaction; false when the name was already taken, by a call in this
  // process or before a restart.
  reserve(hello: { key: string; value: Uint8Array }, expiresAt: number): Promise<boolean>;
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, value: Uint8Array): Promise<void>;
  // Ascending, from start (inclusive) to end (exclusive), at most limit.
  list(options: { start: string; end: string; limit: number }): Promise<Map<string, Uint8Array>>;
};

// Body bytes are gathered this long before they are sealed into one frame: how soon a reader sees them.
const GATHER_MS = 50;
const GATHER_BYTES = 64 * 1024;
// Sealed frames wait in memory until they are written as one page, so a reply writes one row per PERSIST_MS, not one per
// frame: a write rate, kept low for the disk and the fsync each commit costs.
const PERSIST_MS = 2000;
const PAGE_BYTES = 256 * 1024;
// How long a call may run. The outbound's undici timeouts sit above it (outbound.ts), so this limit cuts a quiet provider.
const LIMIT_MS = 14.5 * 60 * 1000;
// The provider's body bytes a call keeps; past them it ends as limit, as at its time. A long reply with long reasoning
// is a few MB of text, and its SSE envelope can take some ten times that.
const LIMIT_BYTES = 32 * 1024 * 1024;
// Pages a reader takes from storage at once. A page holds PAGE_BYTES and at most one frame more.
const PAGE = 4;
// Whatever no device came back for is dropped this long after the call started.
const KEEP_MS = 24 * 60 * 60 * 1000;
// Ping idle readers before Cloudflare's 100 s/mobile 30–60 s timeouts, including provider thinking before first output.
const PING_MS = 25 * 1000;

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
// Named through crypto itself, so this module reads the same under the server's Node types and the DOM types of tests and e2e.
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const encode = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
// A page is keyed by the seq of its last frame, so a reader listing from a seq gets the page holding it; the reader
// drops the frames before its seq. hello is a page of its own at f:0.
const frameKey = (seq: number) => `f:${String(seq).padStart(10, '0')}`;
const seqOf = (key: string) => Number(key.slice(2));
// Past every frame key: ';' follows ':'.
const FRAMES_END = 'f;';

function frame(type: number, seq: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(9 + body.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 5 + body.byteLength);
  view.setUint8(4, type);
  view.setUint32(5, seq);
  out.set(body, 9);
  return out;
}

function nonce(seq: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setUint32(8, seq);
  return iv;
}

function concat(parts: Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const json = (status: number, error: ServerError) => Response.json({ error }, { status });

// Of the relay's own refusals, only an address it could not reach is worth a try sent again.
async function passing(response: Response, statuses: Retry['statuses']): Promise<boolean> {
  if (response.headers.get(RELAY_HEADER) === 'upstream') return statuses.includes(response.status);
  const body: unknown = await response.clone().json().catch(() => null);
  return isRecord(body) && body.error === 'upstream-unreachable';
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', stop, { once: true });
  });

// Memory holds gapless frames from persisted onward plus reader output; earlier pages live in storage.
// Evict only when idle: no pending start, running call or reader.
export class StreamBox {
  private next = 0;
  private persisted = 0;
  private pending: { seq: number; bytes: Uint8Array }[] = [];
  private pendingBytes = 0;
  private persisting: ReturnType<typeof setTimeout> | null = null;
  private waiting = new Set<() => void>();
  private call: AbortController | null = null;
  private dropped = false;
  // A write failed: nothing more is written, END least of all, and every reader ends with an error.
  private broken = false;
  private readers = 0;
  private starts = 0;
  private writes = Promise.resolve();
  running = false;
  // Settles when the call is over; already settled for a box that never ran one. Never rejects.
  ended = Promise.resolve();

  constructor(
    private readonly storage: BoxStorage,
    private readonly upstream: Upstream,
    private readonly idle: () => void,
    private readonly allowance: RelayAllowance,
  ) {}

  // leave: ends the account's live call (calls.ts), once this start is refused or its call is over.
  async start({ id, key, request, bytes, retry }: { id: string; key: unknown; request: unknown; bytes: number; retry?: Retry }, signal: AbortSignal, leave: () => void, counted?: () => void): Promise<Response> {
    this.starts++;
    let ran = false;
    try {
      const theirs = typeof key === 'string' ? fromBase64(key) : null;
      const pair = (await crypto.subtle.generateKey(P256, false, ['deriveBits'])) as { publicKey: Key; privateKey: Key };
      let sealing: Key;
      try {
        const public_ = await crypto.subtle.importKey('raw', theirs ?? new Uint8Array(), P256, false, []);
        const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: public_ }, pair.privateKey, 256);
        const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        sealing = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encode(id), info: encode('risu-alpha stream') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      } catch {
        return json(400, 'bad-key');
      }
      const hello = frame(HELLO, 0, new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
      // A DELETE while the key was derived took the name from the registry. Checked once, here: the store's reserve
      // answers without I/O, so nothing can drop the box between it and the call.
      if (this.dropped) return json(404, 'stream-gone');
      // Two starts of one name both get here; the reservation lets one through.
      if (!(await this.storage.reserve({ key: frameKey(0), value: hello }, Date.now() + KEEP_MS))) return json(409, 'stream-exists');
      this.next = this.persisted = 1;
      this.call = new AbortController();
      this.running = true;
      ran = true;
      this.ended = this.run(request, bytes, retry ?? null, sealing, this.call.signal, counted).finally(leave);
      return await this.read(0, signal);
    } finally {
      if (!ran) leave();
      this.starts--;
      this.release();
    }
  }

  stop() {
    this.call?.abort();
  }

  // Ends the call and every reader and waits out a write already under way, so the registry removes the stream's rows
  // after the last page this box writes.
  async drop() {
    this.dropped = true;
    if (this.persisting) clearTimeout(this.persisting);
    this.call?.abort();
    this.wake();
    await this.writes;
  }

  private release() {
    if (!this.starts && !this.running && !this.readers) this.idle();
  }

  private async run(envelope: unknown, bytes: number, retry: Retry | null, sealing: Key, signal: AbortSignal, counted: (() => void) | undefined) {
    let limited = false;
    const cut = () => {
      limited = true;
      this.call?.abort();
    };
    const limit = setTimeout(cut, LIMIT_MS);
    let gathered: Uint8Array[] = [];
    let size = 0;
    let gathering: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (gathering) clearTimeout(gathering);
      gathering = null;
      if (!size) return;
      const body = concat(gathered, size);
      gathered = [];
      size = 0;
      this.append(sealing, DATA, body);
    };
    const began = Date.now();
    let received = 0;
    let end: Reason = { reason: 'done' };
    try {
      let response: Response;
      let tries = 0;
      for (;;) {
        tries++;
        response = await forward(this.upstream, envelope, bytes, signal, this.allowance);
        const wait = retry && tries <= retry.times && !signal.aborted && (await passing(response, retry.statuses)) ? retryWait(tries, response.headers.get('retry-after'), Date.now()) : null;
        if (wait === null) break;
        await response.body?.cancel();
        this.append(sealing, WAIT, new Uint8Array());
        await sleep(wait, signal);
      }
      if (response.ok) counted?.();
      this.append(sealing, HEAD, encode(JSON.stringify({ status: response.status, statusText: response.statusText, headers: [...response.headers], tries })));
      const reader = response.body?.getReader();
      while (reader) {
        // Upstream is read no faster than its frames are sealed and its full pages stored.
        await this.writes;
        const { done, value } = await reader.read();
        if (done) break;
        gathered.push(value);
        size += value.byteLength;
        received += value.byteLength;
        if (received > LIMIT_BYTES) cut();
        if (size >= GATHER_BYTES) flush();
        else gathering ??= setTimeout(flush, GATHER_MS);
      }
    } catch (error) {
      end = limited || error instanceof RelayTrafficLimit || signal.reason instanceof RelayTrafficLimit ? { reason: 'limit' } : signal.aborted ? { reason: 'stopped' } : { reason: 'network', detail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(limit);
    }
    flush();
    this.append(sealing, END, encode(JSON.stringify({ ...end, ms: Date.now() - began })));
    // A call that has ended has stored every frame, unless a write failed.
    await this.persist();
    this.running = false;
    this.call = null;
    this.wake();
    this.release();
  }

  // Every write runs in order on one chain that never rejects: a failed step breaks the box, which skips every later one.
  private chain(step: () => Promise<void>): Promise<void> {
    this.writes = this.writes.then(async () => {
      if (this.dropped || this.broken) return;
      try {
        await step();
      } catch (error) {
        this.break(error);
      }
    });
    return this.writes;
  }

  private break(error: unknown) {
    this.broken = true;
    if (this.persisting) clearTimeout(this.persisting);
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'stream write failed', error: String(error) }));
    this.call?.abort();
    this.wake();
  }

  // Sealed in order: each frame waits for the one before it. A frame that would take the page past its bytes is
  // written after the page, as one of its own at most.
  private append(sealing: Key, type: number, body: Uint8Array<ArrayBuffer>) {
    const seq = this.next++;
    void this.chain(async () => {
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(seq), additionalData: new Uint8Array([type]) }, sealing, body));
      if (this.dropped) return;
      const bytes = frame(type, seq, sealed);
      if (this.pendingBytes && this.pendingBytes + bytes.byteLength > PAGE_BYTES) await this.writePage();
      this.pending.push({ seq, bytes });
      this.pendingBytes += bytes.byteLength;
      this.persisting ??= setTimeout(() => void this.persist(), PERSIST_MS);
      this.wake();
    });
  }

  // Pending frames are kept until their page is written, so a reader finds every frame in memory or in storage.
  private persist(): Promise<void> {
    return this.chain(() => this.writePage());
  }

  private async writePage() {
    if (this.persisting) clearTimeout(this.persisting);
    this.persisting = null;
    if (this.dropped || !this.pending.length) return;
    const page = this.pending;
    const bytes = concat(page.map((each) => each.bytes), this.pendingBytes);
    const last = page[page.length - 1]!.seq;
    await this.storage.put(frameKey(last), bytes);
    this.persisted = last + 1;
    this.pending = this.pending.slice(page.length);
    this.pendingBytes -= bytes.byteLength;
    if (this.pending.length) this.persisting ??= setTimeout(() => void this.persist(), PERSIST_MS);
    this.wake();
  }

  private wake() {
    const waiting = this.waiting;
    this.waiting = new Set();
    for (const resolve of waiting) resolve();
  }

  // Replay hello, then frames from seq: persisted pages first, then live memory.
  // After restart/completion only storage remains; filter earlier frames from the containing page.
  async read(from: number, signal: AbortSignal): Promise<Response> {
    this.readers++;
    let reading = true;
    let ping: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (!reading) return;
      reading = false;
      clearTimeout(ping);
      this.readers--;
      this.release();
    };
    // The body's cancel alone is not enough: a server whose client left before the response existed never reads or
    // cancels it.
    signal.addEventListener('abort', done);
    if (signal.aborted) done();
    let hello: Uint8Array | undefined;
    try {
      hello = await this.storage.get(frameKey(0));
    } catch (error) {
      done();
      throw error;
    }
    if (!hello) {
      done();
      return json(404, 'stream-gone');
    }
    const first = hello;
    let seq = Math.max(1, from);
    const send = (reader: ReadableStreamDefaultController<Uint8Array>, bytes: Uint8Array) => {
      // Replays are traffic too. Close without END on exhaustion: the client reports a lost/cut reply, and unlike
      // an errored body it does not reconnect forever. The stored frames remain readable after the daily reset.
      if (!this.allowance.take(bytes.byteLength)) {
        this.call?.abort(new RelayTrafficLimit());
        done();
        reader.close();
        return false;
      }
      reader.enqueue(bytes);
      return true;
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start: (reader) => { send(reader, first); },
        pull: async (reader) => {
          // A pull starts once the frame before it was taken, so quiet counts from here: a page written meanwhile
          // wakes the wait below with nothing to send.
          const pingAt = Date.now() + PING_MS;
          try {
            for (;;) {
              if (this.broken) {
                done();
                return reader.error(new Error('stream write failed'));
              }
              if (this.dropped) {
                done();
                return reader.close();
              }
              // Read before the list: a call that had ended by then had stored every frame.
              const running = this.running;
              if (seq < this.persisted || !running) {
                const pages = await this.storage.list({ start: frameKey(seq), end: FRAMES_END, limit: PAGE });
                for (const [key, bytes] of pages) {
                  if (!send(reader, bytes)) return;
                  seq = seqOf(key) + 1;
                }
                if (pages.size) return;
                if (!running) {
                  done();
                  return reader.close();
                }
              }
              const held = this.pending.length - (seq - this.persisted);
              if (held > 0) {
                for (const { bytes } of this.pending.slice(-held)) if (!send(reader, bytes)) return;
                seq += held;
                return;
              }
              if (!this.running) continue;
              const woken = await new Promise<boolean>((resolve) => {
                const wake = () => resolve(true);
                this.waiting.add(wake);
                // Armed only while counted: a body read on after its request was aborted would leave a timer behind.
                if (reading)
                  ping = setTimeout(() => {
                    this.waiting.delete(wake);
                    resolve(false);
                  }, pingAt - Date.now());
              });
              clearTimeout(ping);
              if (!woken) {
                send(reader, frame(PING, 0, new Uint8Array()));
                return;
              }
            }
          } catch (error) {
            done();
            throw error;
          }
        },
        cancel: done,
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-stream': 'frames' } });
  }
}
