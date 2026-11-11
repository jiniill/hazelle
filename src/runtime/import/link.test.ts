import { afterEach, expect, it, vi } from 'vitest';
import { RELAY_HEADER } from '../../contracts/http';
import { directTransport, holdTransport, accountTransport } from '../models/relay';
import { downloadLink, fileName, readLink } from './link';

const ID = '39e4509e-82f1-4709-ad0a-665e6666a025';
const realm = { kind: 'realm', id: ID } as const;
const direct = { kind: 'direct', url: 'https://files.example/a/bot.charx?x=1' } as const;
const signal = new AbortController().signal;
const relayed = (body: BodyInit | null, init: ResponseInit = {}) => new Response(body, { ...init, headers: { [RELAY_HEADER]: 'upstream', ...init.headers } });
const refused = (body: object) => new Response(JSON.stringify(body), { status: 502, headers: { [RELAY_HEADER]: 'error' } });
afterEach(() => vi.unstubAllGlobals());

it('tells what people paste apart', () => {
  expect(readLink(`https://realm.risuai.net/character/${ID}`)).toEqual(realm);
  expect(readLink(`  봇: realm.risuai.net/character/${ID.toUpperCase()}?x=1 `)).toEqual(realm);
  expect(readLink(` 받기: https://files.example/bot.png  `)).toEqual({ kind: 'direct', url: 'https://files.example/bot.png' });
  expect(readLink('받기 https://drive.proton.me/urls/AB-C_1#pass~word ')).toEqual({ kind: 'proton', url: 'https://drive.proton.me/urls/AB-C_1#pass~word' });
  expect(readLink('http://files.example/bot.png')).toBeNull();
  expect(readLink('그냥 글자')).toBeNull();
});

it('names a Realm file by what Realm sends and reports its progress', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), { headers: { 'content-type': 'application/charx', 'content-length': '4' } })));
  const progress = vi.fn();
  const answer = await downloadLink(realm, signal, progress);
  expect(answer.ok && 'files' in answer && [answer.files[0]!.name, answer.files[0]!.size]).toEqual(['realm.charx', 4]);
  expect(progress).toHaveBeenLastCalledWith(4, 4);
  expect(vi.mocked(fetch).mock.calls[0]![1]!.headers).toEqual({ 'x-risu-api-version': '4' });
});

it('tells a gone bot, a page instead of a file, a lost line and a cancel apart', async () => {
  const answers = [new Response('no', { status: 404 }), new Response('<html>', { headers: { 'content-type': 'text/html' } })];
  vi.stubGlobal('fetch', vi.fn(async () => { const next = answers.shift(); if (!next) throw new TypeError('failed'); return next; }));
  expect(await downloadLink(realm, signal, () => {})).toEqual({ ok: false, failure: { kind: 'missing' } });
  expect(await downloadLink(realm, signal, () => {})).toEqual({ ok: false, failure: { kind: 'not-a-file' } });
  expect(await downloadLink(realm, signal, () => {})).toEqual({ ok: false, failure: { kind: 'lost' } });
  expect(await downloadLink(realm, AbortSignal.abort(), () => {})).toEqual({ ok: false, failure: { kind: 'cancelled' } });
});

it('follows a redirect through the relay and names the file from where it landed', async () => {
  const answers = [refused({ error: 'upstream-redirect', status: 302, location: '/real/bot.charx' }), relayed(new Uint8Array(3))];
  vi.stubGlobal('fetch', vi.fn(async () => answers.shift()));
  const answer = await downloadLink(direct, signal, () => {});
  expect(answer.ok && 'files' in answer && [answer.files[0]!.name, answer.files[0]!.size]).toEqual(['bot.charx', 3]);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string).url).toBe('https://files.example/real/bot.charx');
});

it('stops at a web page and at endless redirects', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => refused({ error: 'upstream-not-api' })));
  expect(await downloadLink(direct, signal, () => {})).toEqual({ ok: false, failure: { kind: 'not-a-file' } });
  vi.stubGlobal('fetch', vi.fn(async () => refused({ error: 'upstream-redirect', status: 302, location: '/again' })));
  expect(await downloadLink(direct, signal, () => {})).toEqual({ ok: false, failure: { kind: 'refused' } });
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('names a file from its header or address, else by its first bytes', () => {
  expect(fileName('https://x.example/d/1', "attachment; filename=\"a.png\"; filename*=UTF-8''%EB%B4%87.charx", undefined)).toBe('봇.charx');
  expect(fileName('https://x.example/d/%EB%B4%87.risum', null, undefined)).toBe('봇.risum');
  expect(fileName('https://x.example/d/1', null, new Uint8Array([0x50, 0x4b]))).toBe('1.zip');
  expect(fileName('https://x.example/', 'attachment; filename="../../봇"', new Uint8Array([0x89, 0x50]))).toBe('봇.png');
});

it('tells a guest a Proton link needs an account, without loading its heavy module', async () => {
  holdTransport(directTransport('guest'));
  try {
    expect(await downloadLink({ kind: 'proton', url: 'https://drive.proton.me/urls/A#b' }, signal, () => {})).toEqual({ ok: false, failure: { kind: 'needs-account' } });
  } finally {
    holdTransport(accountTransport);
  }
});
