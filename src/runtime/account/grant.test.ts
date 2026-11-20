import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openRouter } from '../../connectors/openrouter';
import type { Granting } from './grant';

const type = openRouter as Granting;
const BACK = 'https://hazelle.test/';

// One browser: what it keeps, where it stands, and the provider's answer to an exchange.
function browser(answer: () => Response) {
  const kept = new Map<string, string>();
  const at = { search: '', pathname: '/', hash: '' };
  const sent: { url: string; body: string }[] = [];
  vi.stubGlobal('localStorage', { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) });
  vi.stubGlobal('location', at);
  vi.stubGlobal('history', { state: null, replaceState: (_state: unknown, _title: string, address: string) => void (at.search = address.includes('?') ? address.slice(address.indexOf('?')) : '') });
  vi.stubGlobal('fetch', async (url: string, { body }: { body: string }) => {
    sent.push({ url, body });
    return answer();
  });
  return { kept, at, sent };
}

// A page load: the module's memory of its arrival starts over.
const page = () => import('./grant');

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it("derives RFC 7636's challenge from its verifier", async () => {
  expect(await (await page()).challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

it('exchanges the code that comes back for a key, once, and leaves neither the code nor the verifier behind', async () => {
  const { kept, at, sent } = browser(() => Response.json({ key: 'sk-or-v1-made' }));
  const asked = new URL((await (await page()).grantPage(type, BACK))!);
  expect(asked.origin + asked.pathname).toBe('https://openrouter.ai/auth');
  expect(asked.searchParams.get('callback_url')).toBe(BACK);
  expect(asked.searchParams.get('code_challenge_method')).toBe('S256');

  at.search = `?code=abc&state=${asked.searchParams.get('state')}`;
  const { grantReturn, settleGrant, challengeOf } = await page();
  const back = grantReturn()!;
  expect(grantReturn()).toBe(back);
  expect(back.type).toBe('openrouter');
  expect(at.search).toBe('');
  expect(kept.size).toBe(0);
  expect(await back.key).toEqual({ ok: true, secret: 'sk-or-v1-made' });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.url).toBe('https://openrouter.ai/api/v1/auth/keys');
  const body = JSON.parse(sent[0]!.body) as { code: string; code_verifier: string };
  expect(body.code).toBe('abc');
  expect(await challengeOf(body.code_verifier)).toBe(asked.searchParams.get('code_challenge'));
  settleGrant();
  expect(grantReturn()).toBeNull();
});

it('calls a code nothing here asked for, or one come back too late, unasked, and sends nothing', async () => {
  const { at, sent } = browser(() => Response.json({ key: 'sk-or-v1-made' }));
  for (const search of ['?code=abc&state=elsewhere', '?code=abc']) {
    vi.resetModules();
    at.search = search;
    const strange = (await page()).grantReturn()!;
    expect(strange.type).toBeNull();
    expect(at.search).toBe('');
    expect(await strange.key).toEqual({ ok: false, failure: { kind: 'unasked' } });
  }

  vi.resetModules();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
  const asked = new URL((await (await page()).grantPage(type, BACK))!);
  clock.mockReturnValue(16 * 60_000);
  at.search = `?code=abc&state=${asked.searchParams.get('state')}`;
  vi.resetModules();
  expect(await (await page()).grantReturn()!.key).toEqual({ ok: false, failure: { kind: 'unasked' } });
  clock.mockRestore();
  expect(sent).toHaveLength(0);
});

it("says the provider's refusal and an answer without a key apart, and is no arrival without a code", async () => {
  const answers = [Response.json({ error: { message: 'Invalid code or code_verifier', code: 403 } }, { status: 403 }), Response.json({})];
  const { at } = browser(() => answers.shift()!);
  expect((await page()).grantReturn()).toBeNull();
  for (const expected of [{ kind: 'provider', status: 403 }, { kind: 'bad-answer' }]) {
    vi.resetModules();
    const asked = new URL((await (await page()).grantPage(type, BACK))!);
    at.search = `?code=abc&state=${asked.searchParams.get('state')}`;
    vi.resetModules();
    expect(await (await page()).grantReturn()!.key).toMatchObject({ ok: false, failure: expected });
  }
});
