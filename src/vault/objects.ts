import { deflateSync, inflateSync } from 'fflate';
import { encodeText, fromBase64, openBytes, sealBytes, toBase64 } from './aead';
import type { VaultKey } from './keys';

export type ObjectAddress = { id: string; kind: string; parent: string | null };

// Format 1: leading format byte, then AES-256-GCM over deflate-raw JSON.
const FORMAT = 1;

// The server cannot move a body to another object, kind, parent or account without failing this AAD.
const objectAad = (accountId: string, { id, kind, parent }: ObjectAddress) => `risu-alpha/object/v1/${accountId}/${id}/${kind}/${parent ?? ''}`;

// A key of its own, derived from the vault key, so object bodies and key wraps never share a key.
export async function objectKey(vaultKey: VaultKey): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', vaultKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encodeText('risu-alpha objects v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealObject(key: CryptoKey, accountId: string, address: ObjectAddress, value: unknown): Promise<string> {
  const sealed = await sealBytes(key, deflateSync(encodeText(JSON.stringify(value))), objectAad(accountId, address));
  const body = new Uint8Array(1 + sealed.length);
  body[0] = FORMAT;
  body.set(sealed, 1);
  return toBase64(body);
}

// undefined means the body cannot be read: an unknown format, a wrong key, or a body the server altered or moved.
export async function openObject(key: CryptoKey, accountId: string, address: ObjectAddress, body: string): Promise<unknown> {
  const bytes = fromBase64(body);
  if (bytes[0] !== FORMAT) return undefined;
  const compressed = await openBytes(key, bytes.subarray(1), objectAad(accountId, address));
  if (!compressed) return undefined;
  // Synchronous: a stream per object cost more than the inflating itself, across thousands of objects on open.
  return JSON.parse(new TextDecoder().decode(inflateSync(compressed)));
}
