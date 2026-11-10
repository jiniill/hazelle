import type { SignIn } from './types';
import type { HttpRequest } from '../contracts/http';
import { isRecord } from '../record';

// RFC 8628, read as GitHub sends it. The code's lifetime and the polling interval are in seconds.
export type DeviceCode = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };

// slow_down may name the new interval; without one, RFC 8628 §3.5 adds five seconds.
export type Poll =
  | { state: 'pending' }
  | { state: 'slow-down'; interval: number | null }
  | { state: 'done'; secret: string }
  | { state: 'failed'; code: string };

const DEFAULT_INTERVAL = 5;

// Without accept: application/json, GitHub answers form-encoded.
function form(url: string, signIn: SignIn, fields: Record<string, string>): HttpRequest {
  return {
    url,
    method: 'POST',
    headers: { ...signIn.headers, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

export function codeRequest(signIn: SignIn): HttpRequest {
  return form(signIn.codeUrl, signIn, { client_id: signIn.clientId, scope: signIn.scope });
}

// The verification address is opened in a new tab, so only an https one is taken.
export function parseCode(payload: unknown): DeviceCode | null {
  if (!isRecord(payload)) return null;
  const { device_code: deviceCode, user_code: userCode, verification_uri: verificationUri } = payload;
  const expiresIn = seconds(payload.expires_in);
  if (typeof deviceCode !== 'string' || !deviceCode || typeof userCode !== 'string' || !userCode) return null;
  if (typeof verificationUri !== 'string' || !verificationUri.startsWith('https://') || expiresIn === null) return null;
  return { deviceCode, userCode, verificationUri, expiresIn, interval: seconds(payload.interval) ?? DEFAULT_INTERVAL };
}

export function pollRequest(signIn: SignIn, deviceCode: string): HttpRequest {
  return form(signIn.tokenUrl, signIn, {
    client_id: signIn.clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
}

export function parsePoll(payload: unknown): Poll | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.access_token === 'string' && payload.access_token) return { state: 'done', secret: payload.access_token };
  if (payload.error === 'authorization_pending') return { state: 'pending' };
  if (payload.error === 'slow_down') return { state: 'slow-down', interval: seconds(payload.interval) };
  if (typeof payload.error === 'string' && payload.error) return { state: 'failed', code: payload.error };
  return null;
}
