import { openBytes, randomBytes, sealBytes, withFormat } from './aead';
import { fromBase64, toBase64 } from '../base64';

// A share link's key: 32 random bytes in base64url, made by the sharer's page and kept in the link's fragment and the
// sharer's vault (model/share), never sent to the server but inside a report's full link.
export const SHARE_KEY = /^[A-Za-z0-9_-]{43}$/;
// The leading byte names the format. Format 1: AES-256-GCM under the link's key, a fresh nonce for every version.
const FORMAT = 1;
const AAD = 'hazelle/share/v1';

const toUrl = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl = (text: string) => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
const keyOf = (key: string) => crypto.subtle.importKey('raw', fromUrl(key), 'AES-GCM', false, ['encrypt', 'decrypt']);

export const newShareKey = () => toUrl(randomBytes(32));

export async function sealShare(key: string, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return withFormat(FORMAT, await sealBytes(await keyOf(key), bytes, AAD));
}

// null: an unknown format, or a key that is not this link's.
export async function openShare(key: string, body: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (body[0] !== FORMAT || !SHARE_KEY.test(key)) return null;
  return openBytes(await keyOf(key), body.subarray(1), AAD);
}
