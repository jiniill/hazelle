import { deflateSync, inflateSync } from 'fflate';
import { encodeText, openBytes, sealBytes, vaultSubkey, withFormat } from './aead';
import { fromBase64, toBase64 } from '../base64';
import type { VaultKey } from './keys';

export type ObjectAddress = { id: string; kind: string; parent: string | null };

// Format 1: leading format byte, then AES-256-GCM over deflate-raw JSON.
const FORMAT = 1;

// The server cannot move a body to another object, kind, parent or account without failing this AAD.
const objectAad = (accountId: string, { id, kind, parent }: ObjectAddress) => `risu-alpha/object/v1/${accountId}/${id}/${kind}/${parent ?? ''}`;

// A key of its own, so object bodies and key wraps never share a key.
export const objectKey = (vaultKey: VaultKey) => vaultSubkey(vaultKey, 'risu-alpha objects v1');

export async function sealObject(key: CryptoKey, accountId: string, address: ObjectAddress, value: unknown): Promise<string> {
  const sealed = await sealBytes(key, deflateSync(encodeText(JSON.stringify(value))), objectAad(accountId, address));
  return toBase64(withFormat(FORMAT, sealed));
}

// fflate grows a buffer of its own per object, 128 KiB at once, which cost most of an account's open; one buffer is
// reused instead. An output that fills it may have been cut short, so it is inflated again on its own.
let inflated: Uint8Array | null = null;
function inflate(compressed: Uint8Array): Uint8Array {
  inflated ??= new Uint8Array(1 << 20);
  const into = inflateSync(compressed, { out: inflated });
  return into.length < inflated.length ? into : inflateSync(compressed);
}

// undefined means the body cannot be read: an unknown format, a wrong key, or a body the server altered or moved.
export async function openObject(key: CryptoKey, accountId: string, address: ObjectAddress, body: string): Promise<unknown> {
  const bytes = fromBase64(body);
  if (bytes[0] !== FORMAT) return undefined;
  const compressed = await openBytes(key, bytes.subarray(1), objectAad(accountId, address));
  if (!compressed) return undefined;
  // Synchronous: a stream per object cost more than the inflating itself, across thousands of objects on open. The
  // reused buffer is read before the next await, where another open could write it.
  return JSON.parse(new TextDecoder().decode(inflate(compressed)));
}
