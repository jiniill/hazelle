import { afterEach, expect, it, vi } from 'vitest';
import { downloadRealm, realmId } from './realm';

const ID = '39e4509e-82f1-4709-ad0a-665e6666a025';
const signal = new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

it('finds the bot in what people paste, and nothing elsewhere', () => {
  expect(realmId(`https://realm.risuai.net/character/${ID}`)).toBe(ID);
  expect(realmId(`  봇: realm.risuai.net/character/${ID.toUpperCase()}?x=1 `)).toBe(ID);
  expect(realmId(`https://drive.proton.me/urls/${ID}`)).toBeNull();
  expect(realmId('https://realm.risuai.net/')).toBeNull();
});

it('names the file by what Realm sends and reports its progress', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), { headers: { 'content-type': 'application/charx', 'content-length': '4' } })));
  const progress = vi.fn();
  const answer = await downloadRealm(ID, signal, progress);
  expect(answer.ok && [answer.file.name, answer.file.size]).toEqual(['realm.charx', 4]);
  expect(progress).toHaveBeenLastCalledWith(4, 4);
  expect(vi.mocked(fetch).mock.calls[0]![1]!.headers).toEqual({ 'x-risu-api-version': '4' });
});

it('tells a gone bot, a page instead of a file, a lost line and a cancel apart', async () => {
  const answers = [new Response('no', { status: 404 }), new Response('<html>', { headers: { 'content-type': 'text/html' } })];
  vi.stubGlobal('fetch', vi.fn(async () => { const next = answers.shift(); if (!next) throw new TypeError('failed'); return next; }));
  expect(await downloadRealm(ID, signal, () => {})).toEqual({ ok: false, failure: 'missing' });
  expect(await downloadRealm(ID, signal, () => {})).toEqual({ ok: false, failure: 'not-a-bot' });
  expect(await downloadRealm(ID, signal, () => {})).toEqual({ ok: false, failure: 'lost' });
  expect(await downloadRealm(ID, AbortSignal.abort(), () => {})).toEqual({ ok: false, failure: 'cancelled' });
});
