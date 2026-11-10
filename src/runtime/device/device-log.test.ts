import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Receipt } from '../../model/chat';
import { randomBytes } from '../../vault/aead';
import { logCache } from './device-cache';
import { DeviceLog } from './device-log';
import { REQUEST_LOG_LIMITS, RequestLog, type LogEntry } from '../models/request-log';
import type { ObjectStore } from '../store/store';

let account: string;
let vaultKey: Uint8Array<ArrayBuffer>;

beforeEach(() => {
  account = crypto.randomUUID();
  vaultKey = randomBytes(32);
});

const entry = (chat: string, id: string, at: number): LogEntry => ({ chat, purpose: 'reply', at, picked: false, receipt: { id } as Receipt, request: { url: 'https://x.test/v1', body: `{"n":${at}}` }, response: 'ok' });

// A page: its log, and the chat it opens.
function page() {
  let heard: Parameters<ObjectStore['subscribe']>[0] = () => {};
  const log = new RequestLog({ subscribe: (listener) => ((heard = listener), () => true), scopeState: () => 'loaded' }, new DeviceLog(account, vaultKey, logCache(account)));
  return { log, open: (chat: string) => heard([{ kind: 'scope', id: chat, parent: null }]) };
}

it('reads a chat’s calls back on the next page once the chat opens, with what was attached and before calls made meanwhile', async () => {
  const first = page();
  first.log.record(entry('a', '1', 1));
  first.log.attach('a', '1', { wire: [{ content: 'w', index: 0 }] });
  first.log.record(entry('b', '2', 2));
  first.log.close();
  await vi.waitFor(async () => expect(await logCache(account).read('a')).toHaveLength(1));

  const next = page();
  expect(next.log.of('a').entries).toEqual([]);
  next.log.record(entry('a', '3', 3));
  next.open('a');
  await vi.waitFor(() => expect(next.log.of('a').entries.map(({ receipt }) => receipt.id)).toEqual(['1', '3']));
  expect(next.log.entry('a', '1')).toMatchObject({ request: { body: '{"n":1}' }, response: 'ok', wire: [{ content: 'w', index: 0 }] });
  expect(next.log.of('b').entries).toEqual([]);
  next.log.close();
});

it('lets a call the chat’s bound let go leave the device too, and reads no row another build wrote', async () => {
  const first = page();
  for (let at = 0; at <= REQUEST_LOG_LIMITS.entries; at++) first.log.record(entry('a', String(at), at));
  first.log.close();
  await vi.waitFor(async () => expect(await logCache(account).read('a')).toHaveLength(REQUEST_LOG_LIMITS.entries));
  expect((await logCache(account).read('a')).some(([call]) => call === '0')).toBe(false);

  const [[call, row]] = await logCache(account).read('a') as [[string, NonNullable<Parameters<ReturnType<typeof logCache>['write']>[0][number]['row']>]];
  await logCache(account).write([{ chat: 'a', call, row: { ...row, build: 'another' } }], 1_000);
  const next = page();
  next.open('a');
  await vi.waitFor(() => expect(next.log.of('a').entries).toHaveLength(REQUEST_LOG_LIMITS.entries - 1));
  expect(next.log.entry('a', call)).toBeNull();
  next.log.close();
});
