import { afterEach, expect, it, vi } from 'vitest';
import type { Retry } from '../contracts/streams';
import type { Upstream } from './relay';
import { relayBudget } from './limits';
import { StreamBox } from './stream-box';
import { streamStore } from './db/streams-db';
import { replyKey } from './testing';

const CHUNK = 64 * 1024;
const staying = new AbortController().signal;
const PAGE_BYTES = 256 * 1024;
const storage = () => streamStore(':memory:').storage('s');

// A provider that answers as fast as it is read, until the call is aborted, as a fetch's body errors then. It ends
// at twice the box's bound, so a box with no bound holds 64 MB at most. pulled: how many chunks it gave.
function endless() {
  const counted = { pulled: 0 };
  const upstream: Upstream = async (_url, { signal }) =>
    new Response(
      new ReadableStream<Uint8Array>(
        {
          pull: (controller) => {
            if (signal.aborted) return controller.error(signal.reason);
            if (counted.pulled === 1024) return controller.close();
            counted.pulled++;
            controller.enqueue(new Uint8Array(CHUNK));
          },
        },
        { highWaterMark: 0 },
      ),
    );
  return { counted, upstream };
}

async function start(box: StreamBox, retry?: Retry) {
  const { key } = await replyKey();
  const request = { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' };
  return box.start({ id: crypto.randomUUID(), key, request, bytes: 0, ...(retry && { retry }) }, staying, () => {});
}

// A page's frames and the one that closed it are read before the first put has to answer.
it('reads the provider no faster than its pages are stored', async () => {
  const held = storage();
  let open = () => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  const put = held.put;
  held.put = async (key, value) => {
    await gate;
    return put(key, value);
  };
  const { counted, upstream } = endless();
  const box = new StreamBox(held, upstream, () => {}, relayBudget().account('test'));
  await start(box);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(counted.pulled).toBeLessThanOrEqual(PAGE_BYTES / CHUNK + 1);
  open();
  await box.drop();
});

// Every frame's [type, seq] in the order the body carries them, and how many bytes it carried.
async function frames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const seen: [number, number][] = [];
  let buffer = new Uint8Array(0);
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    const joined = new Uint8Array(buffer.byteLength + value.byteLength);
    joined.set(buffer);
    joined.set(value, buffer.byteLength);
    buffer = joined;
    while (buffer.byteLength >= 9 && buffer.byteLength >= 4 + new DataView(buffer.buffer, buffer.byteOffset).getUint32(0)) {
      seen.push([buffer[4]!, new DataView(buffer.buffer, buffer.byteOffset).getUint32(5)]);
      buffer = buffer.slice(4 + new DataView(buffer.buffer, buffer.byteOffset).getUint32(0));
    }
  }
  return { seen, bytes };
}

it('ends a call whose answer passes the byte bound, with what came before it sent', async () => {
  const { upstream } = endless();
  const response = await start(new StreamBox(storage(), upstream, () => {}, relayBudget().account('test')));
  const { seen, bytes } = await frames(response.body!);
  expect(seen.at(-1)![0]).toBe(3);
  expect(bytes / 2 ** 20).toBeGreaterThan(32);
  expect(bytes / 2 ** 20).toBeLessThan(33);
});

it('stores a short reply as one page, which a read from inside it still ends', async () => {
  const held = storage();
  const upstream: Upstream = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < 10; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            controller.enqueue(new Uint8Array(100));
          }
          controller.close();
        },
      }),
    );
  const box = new StreamBox(held, upstream, () => {}, relayBudget().account('test'));
  const live = await frames((await start(box)).body!);
  expect(live.seen.length).toBeGreaterThan(4);
  expect(live.seen.at(-1)![0]).toBe(3);
  const pages = await held.list({ start: 'f:', end: 'f;', limit: 10 });
  expect([...pages.keys()]).toEqual(['f:0000000000', `f:${String(live.seen.length - 1).padStart(10, '0')}`]);
  const again = await frames((await box.read(3, staying)).body!);
  expect(again.seen[0]).toEqual([0, 0]);
  expect(again.seen.at(-1)).toEqual(live.seen.at(-1));
});

// Only the first write fails, so a write tried after it would be stored and seen.
it('ends its readers with an error, aborts the call and tries no write, END included, once a page write fails', async () => {
  const held = storage();
  const put = held.put;
  let puts = 0;
  held.put = async (key, value) => {
    if (++puts === 1) throw new Error('disk full');
    return put(key, value);
  };
  let aborted = false;
  const upstream: Upstream = async (_url, { signal }) => {
    signal.addEventListener('abort', () => (aborted = true));
    return new Response(new ReadableStream({ pull: (body) => (signal.aborted ? body.error(signal.reason) : body.enqueue(new Uint8Array(CHUNK))) }, { highWaterMark: 0 }));
  };
  const box = new StreamBox(held, upstream, () => {}, relayBudget().account('test'));
  const reading = frames((await start(box)).body!);
  await expect(reading).rejects.toThrow('stream write failed');
  await box.ended;
  expect(aborted).toBe(true);
  expect(box.running).toBe(false);
  expect(puts).toBe(1);
  expect([...(await held.list({ start: 'f:', end: 'f;', limit: 10 })).keys()]).toEqual(['f:0000000000']);
});

// As a server does with a request whose client left: the body is never read or cancelled.
it.each([true, false])('stops counting a reader whose client left (before its response was built: %s)', async (before) => {
  const held = storage();
  await held.reserve({ key: 'f:0000000000', value: new Uint8Array(9) }, Date.now() + 60_000);
  let idle = 0;
  const box = new StreamBox(held, endless().upstream, () => idle++, relayBudget().account('test'));
  const request = new AbortController();
  if (before) request.abort();
  expect((await box.read(0, request.signal)).status).toBe(200);
  request.abort();
  expect(idle).toBe(1);
});

// A provider that answers its headers at once and its body only as the test writes it.
function silent() {
  const body = new TransformStream<Uint8Array, Uint8Array>();
  const writer = body.writable.getWriter();
  const upstream: Upstream = async (_url, { signal }) => {
    signal.addEventListener('abort', () => void writer.abort(signal.reason).catch(() => {}));
    return new Response(body.readable);
  };
  return { upstream, writer };
}

// The next frame's [type, seq], read only when asked: a box's reader waits, and pings, only while its body is read.
function framer(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  return async (): Promise<[number, number] | null> => {
    for (;;) {
      const view = new DataView(buffer.buffer, buffer.byteOffset);
      if (buffer.byteLength >= 9 && buffer.byteLength >= 4 + view.getUint32(0)) {
        const seen: [number, number] = [buffer[4]!, view.getUint32(5)];
        buffer = buffer.slice(4 + view.getUint32(0));
        return seen;
      }
      const { done, value } = await reader.read();
      if (done) return null;
      const joined = new Uint8Array(buffer.byteLength + value.byteLength);
      joined.set(buffer);
      joined.set(value, buffer.byteLength);
      buffer = joined;
    }
  };
}

afterEach(() => void vi.useRealTimers());

// Real crypto seals each frame, so a frame is awaited before fake time moves on.
it('pings a reader of a silent call, with no seq of its own and nothing stored', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const held = storage();
  const { upstream, writer } = silent();
  const box = new StreamBox(held, upstream, () => {}, relayBudget().account('test'));
  const next = framer((await start(box)).body!);
  const seen = [await next(), await next()];
  for (let i = 0; i < 3; i++) {
    const ping = next();
    await vi.advanceTimersByTimeAsync(25_000);
    seen.push(await ping);
  }
  await writer.write(new Uint8Array(100));
  const data = next();
  await vi.advanceTimersByTimeAsync(50);
  seen.push(await data);
  await writer.close();
  seen.push(await next(), await next());
  await box.ended;
  expect(seen).toEqual([[0, 0], [1, 1], [4, 0], [4, 0], [4, 0], [2, 2], [3, 3], null]);
  const pages = await held.list({ start: 'f:', end: 'f;', limit: 100 });
  const kept = await frames(new ReadableStream({ start: (body) => (pages.forEach((page) => body.enqueue(page)), body.close()) }));
  expect(kept.seen).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
});

it('leaves no ping timer behind a reader whose client left, and the box still goes idle', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  let idle = 0;
  const { upstream, writer } = silent();
  const box = new StreamBox(storage(), upstream, () => idle++, relayBudget().account('test'));
  const first = framer((await start(box)).body!);
  await first();
  await first();
  // HEAD's page is written, so the call's limit is the one timer left.
  await vi.advanceTimersByTimeAsync(3000);
  const request = new AbortController();
  const next = framer((await box.read(2, request.signal)).body!);
  await next();
  const timers = vi.getTimerCount();
  expect(timers).toBe(1);
  const ping = next();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(timers + 1);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await ping).toEqual([4, 0]);
  const data = next();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(timers + 1);
  request.abort();
  expect(vi.getTimerCount()).toBe(timers);
  // Its body is still read, as a server may go on doing after its client left.
  await writer.write(new Uint8Array(100));
  await vi.advanceTimersByTimeAsync(50);
  expect(await data).toEqual([2, 2]);
  void next();
  await vi.advanceTimersByTimeAsync(3000);
  expect(vi.getTimerCount()).toBe(timers);
  box.stop();
  await box.ended;
  while (await first());
  expect(idle).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

// A provider answering each try with the next answer, keeping what each try sent and when. null: its address is not reached.
function tried(...answers: (Response | null)[]) {
  const sent: { at: number; url: string; headers: [string, string][]; body: string | null }[] = [];
  const upstream: Upstream = async (url, init) => {
    sent.push({ at: Date.now(), url: url.href, headers: [...init.headers], body: init.body as string | null });
    const answer = answers.shift()!;
    if (!answer) throw new Error('connect ECONNREFUSED');
    return answer;
  };
  return { sent, upstream };
}
const refusal = (status: number, headers: Record<string, string> = {}) => new Response('{"error":{"message":"busy"}}', { status, headers });
const RETRY: Retry = { times: 2, statuses: [429, 529] };
// The frame types a reader keeps: a page read from storage may repeat frames before the seq asked for.
function sequence({ seen }: { seen: [number, number][] }) {
  let next = 0;
  return seen.filter(([, seq]) => seq >= next && (next = seq + 1)).map(([type]) => type);
}

it('sends a try refused for a moment again, the same request after the wait asked for, and passes on only the last', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const { sent, upstream } = tried(refusal(529), refusal(429, { 'retry-after': '7' }), new Response('data: {}\n\n'));
  const box = new StreamBox(storage(), upstream, () => {}, relayBudget().account('test'));
  const reading = frames((await start(box, RETRY)).body!);
  for (let tick = 0; tick < 40 && box.running; tick++) await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(2000);
  expect(sequence(await reading)).toEqual([0, 5, 5, 1, 2, 3]);
  expect(sent.map(({ at }) => at - sent[0]!.at)).toEqual([0, 2000, 9000]);
  expect(new Set(sent.map((each) => JSON.stringify({ ...each, at: 0 }))).size).toBe(1);
});

it('sends a try whose address was not reached again, and no more than its times', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const { sent, upstream } = tried(null, refusal(429), refusal(429));
  const box = new StreamBox(storage(), upstream, () => {}, relayBudget().account('test'));
  const reading = frames((await start(box, RETRY)).body!);
  for (let tick = 0; tick < 40 && box.running; tick++) await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(2000);
  expect(sequence(await reading)).toEqual([0, 5, 5, 1, 2, 3]);
  expect(sent).toHaveLength(3);
});

it('passes on at once an answer its statuses do not name, a reply past its head, and every answer of a call without retry', async () => {
  for (const [answer, retry] of [[refusal(400), RETRY], [refusal(429), undefined], [new Response(new ReadableStream({ pull: (body) => body.error(new Error('reset')) })), RETRY]] as const) {
    const { sent, upstream } = tried(answer);
    const { seen } = await frames((await start(new StreamBox(storage(), upstream, () => {}, relayBudget().account('test')), retry)).body!);
    expect(seen.map(([type]) => type)).not.toContain(5);
    expect(sent).toHaveLength(1);
  }
});

it('ends a call stopped while a try waits to be sent again, with no head and nothing more sent', async () => {
  const { sent, upstream } = tried(refusal(429, { 'retry-after': '30' }), refusal(429));
  const box = new StreamBox(storage(), upstream, () => {}, relayBudget().account('test'));
  const next = framer((await start(box, RETRY)).body!);
  expect([await next(), await next()]).toEqual([[0, 0], [5, 1]]);
  box.stop();
  expect([await next(), await next()]).toEqual([[3, 2], null]);
  expect(sent).toHaveLength(1);
});
