import { toBase64 } from '../../base64';
import { CONNECTION_TYPES } from '../../connectors/registry';
import type { ConnectionType, Grant } from '../../connectors/types';
import { pageJson, type RelayFailure } from '../models/relay';

export type Granting = ConnectionType & { grant: Grant };

// Kept in localStorage, not the tab's own: a person who signs up on the provider's page by an emailed link comes back
// in another tab. until: past the provider's 10 minutes for a code, a return is no answer to this asking.
const HELD = 'hazelle:grant';
const HOLD_MS = 15 * 60_000;
type Held = { type: string; verifier: string; state: string; until: number };

const url64 = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const challengeOf = async (verifier: string) => url64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

// Where to send the person, back being where the provider sends them after. null: this browser keeps nothing, so the
// return could not be matched to its asking.
export async function grantPage(type: Granting, back: string): Promise<string | null> {
  const verifier = url64(crypto.getRandomValues(new Uint8Array(32)));
  const state = url64(crypto.getRandomValues(new Uint8Array(16)));
  try {
    localStorage.setItem(HELD, JSON.stringify({ type: type.id, verifier, state, until: Date.now() + HOLD_MS } satisfies Held));
  } catch {
    return null;
  }
  return type.grant.page(await challengeOf(verifier), state, back);
}

// unasked: a code came back that nothing this browser holds asked for (another browser's, a second return, too late).
export type GrantFailure = RelayFailure | { kind: 'bad-answer' } | { kind: 'unasked' };
type Key = { ok: true; secret: string } | { ok: false; failure: GrantFailure };
// type: whose key it is; null when unasked, which no type owns.
export type GrantReturn = { type: string | null; key: Promise<Key> };

// A code that came with no state matches nothing held.
function held(state: string): Held | null {
  try {
    const kept = JSON.parse(localStorage.getItem(HELD) ?? 'null') as Held | null;
    localStorage.removeItem(HELD);
    return kept?.state === state && kept.until > Date.now() ? kept : null;
  } catch {
    return null;
  }
}

async function exchange(type: Granting, code: string, verifier: string): Promise<Key> {
  const answer = await pageJson(type.grant.exchange(code, verifier), type);
  if (!answer.ok) return answer;
  const secret = type.grant.parse(answer.data);
  return secret ? { ok: true, secret } : { ok: false, failure: { kind: 'bad-answer' } };
}

function read(): GrantReturn | null {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code) return null;
  params.delete('code');
  params.delete('state');
  history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  const kept = held(state ?? '');
  const type = kept && CONNECTION_TYPES.find((each): each is Granting => each.id === kept.type && each.grant !== undefined);
  return type ? { type: type.id, key: exchange(type, code, kept!.verifier) } : { type: null, key: Promise.resolve({ ok: false, failure: { kind: 'unasked' } }) };
}

// The page's arrival from a provider's grant, if it is one. Read once and exchanged once however many screens ask and
// however often they mount: the code is single-use, so it leaves the address and the verifier leaves the browser as
// they are read. settleGrant: its outcome was shown, so no later screen takes it again.
let returned: GrantReturn | null | undefined;
export const grantReturn = (): GrantReturn | null => (returned === undefined ? (returned = read()) : returned);
export const settleGrant = () => {
  returned = null;
};
