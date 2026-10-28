import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomBytes } from '../vault/aead';
import { draftEncryptionKey, openDraft, sealDraft } from '../vault/drafts';
import { draftCache } from './device-cache';
import { Drafts } from './drafts';

let account: string;
let vaultKey: Uint8Array<ArrayBuffer>;
const opened: Drafts[] = [];

beforeEach(() => {
  account = crypto.randomUUID();
  vaultKey = randomBytes(32);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
});

afterEach(async () => {
  for (const drafts of opened.splice(0)) await drafts.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fresh() {
  const drafts = new Drafts();
  opened.push(drafts);
  return drafts;
}

async function reload() {
  const drafts = fresh();
  await drafts.persist(account, vaultKey);
  return drafts;
}

it('round trips encrypted text into a new Drafts without persisting attachments', async () => {
  const drafts = await reload();
  drafts.set('chat', 'Unsent text');
  drafts.attach('chat', { kind: 'file', value: { name: 'notes.txt', title: 'Notes', text: 'Attachment only' } });
  await drafts.close();
  const rows = await draftCache(account).read();
  expect(rows).toHaveLength(1);
  expect(rows[0]![1]).not.toContain('Unsent text');
  const restored = await reload();
  expect(restored.text('chat')).toBe('Unsent text');
  expect(restored.attachments('chat')).toEqual([]);
});

it('removes the device copy when a send takes the text', async () => {
  const drafts = await reload();
  drafts.set('chat', 'Send this');
  await drafts.flush();
  drafts.take('chat');
  await drafts.flush();
  expect(await draftCache(account).read()).toEqual([]);
  expect((await reload()).text('chat')).toBe('');
});

it('merges loaded text before text typed while the read was pending', async () => {
  const key = await draftEncryptionKey(vaultKey);
  await draftCache(account).write([['chat', await sealDraft(key, account, 'chat', 'Earlier')]]);
  const drafts = fresh();
  const loading = drafts.persist(account, vaultKey);
  drafts.set('chat', 'Typed meanwhile');
  await loading;
  expect(drafts.text('chat')).toBe('Earlier\nTyped meanwhile');
  await drafts.flush();
  expect((await reload()).text('chat')).toBe('Earlier\nTyped meanwhile');
});

it('moves the device copy from a new chat key to its saved key', async () => {
  const drafts = await reload();
  drafts.set('new-character', 'Draft');
  await drafts.flush();
  drafts.move('new-character', 'chat');
  await drafts.flush();
  const restored = await reload();
  expect([restored.text('new-character'), restored.text('chat')]).toEqual(['', 'Draft']);
});

it('persists a failed send’s putBack before text typed since', async () => {
  const drafts = await reload();
  drafts.set('chat', 'Sent');
  const taken = drafts.take('chat');
  await drafts.flush();
  drafts.set('chat', 'New');
  drafts.putBack('chat', taken.text);
  await drafts.flush();
  expect((await reload()).text('chat')).toBe('Sent\nNew');
});

it('deletes the device copy when the composer is cleared', async () => {
  const drafts = await reload();
  drafts.set('chat', 'Draft');
  await drafts.flush();
  drafts.set('chat', '');
  await drafts.flush();
  expect(await draftCache(account).read()).toEqual([]);
});

it('keeps unreadable entries untouched even when that draft is edited', async () => {
  const cache = draftCache(account);
  await cache.write([['chat', 'broken ciphertext']]);
  const drafts = await reload();
  expect(drafts.text('chat')).toBe('');
  drafts.set('chat', 'New text');
  drafts.set('other', 'Readable');
  await drafts.flush();
  expect(new Map(await cache.read()).get('chat')).toBe('broken ciphertext');
  expect((await reload()).text('other')).toBe('Readable');
});

it('keeps typing and send recovery working when a device write fails', async () => {
  const drafts = await reload();
  vi.spyOn(draftCache(account), 'write').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
  drafts.set('chat', 'Draft');
  await drafts.flush();
  const taken = drafts.take('chat');
  drafts.putBack('chat', taken.text);
  await drafts.flush();
  expect(drafts.text('chat')).toBe('Draft');
});

it('keeps typing working when the initial device read fails', async () => {
  vi.spyOn(draftCache(account), 'read').mockRejectedValue(new Error('Blocked'));
  const drafts = await reload();
  drafts.set('chat', 'Draft');
  await drafts.flush();
  expect(drafts.text('chat')).toBe('Draft');
});

it('debounces writes until 500 ms after the last text change', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const drafts = await reload();
  const write = vi.spyOn(draftCache(account), 'write');
  drafts.set('chat', 'First');
  await vi.advanceTimersByTimeAsync(400);
  drafts.set('chat', 'Last');
  await vi.advanceTimersByTimeAsync(499);
  expect(write).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect.poll(() => write.mock.calls.length).toBe(1);
  expect(write).toHaveBeenCalledTimes(1);
  expect((await reload()).text('chat')).toBe('Last');
});

it('flushes pending text on pagehide before the debounce expires', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const drafts = await reload();
  drafts.set('chat', 'Leaving now');
  window.dispatchEvent(new Event('pagehide'));
  await expect.poll(async () => (await draftCache(account).read()).length).toBe(1);
  expect((await reload()).text('chat')).toBe('Leaving now');
});

it('flushes pending text when the page becomes hidden', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const drafts = await reload();
  drafts.set('chat', 'Background text');
  Object.assign(document, { visibilityState: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await expect.poll(async () => (await draftCache(account).read()).length).toBe(1);
  expect((await reload()).text('chat')).toBe('Background text');
});

it('keeps the merged text sealed when closed before loading finishes', async () => {
  const key = await draftEncryptionKey(vaultKey);
  await draftCache(account).write([['chat', await sealDraft(key, account, 'chat', 'Stored')]]);
  const drafts = fresh();
  void drafts.persist(account, vaultKey);
  drafts.set('chat', 'Before lock');
  await drafts.close();
  expect(drafts.text('chat')).toBe('');
  const rows = new Map(await draftCache(account).read());
  expect(await openDraft(key, account, 'chat', rows.get('chat')!)).toBe('Stored\nBefore lock');
});
