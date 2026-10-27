import { encodeText, fromBase64, toBase64 } from './aead';

// The key lives only in sealed object bodies.
export type FileRef = { id: string; key: string };

// Convergent format 1: AES-256-GCM over uncompressed file bytes; leading byte versions the format.
// Content-derived keys make body/id identical across accounts. The server verifies SHA-256(sealed body) on upload.
const FORMAT = 1;
const AAD = encodeText('risu-alpha/file/v1');
// One key seals one content only, so a fixed nonce never repeats under a key.
const NONCE = new Uint8Array(12);

export async function sealFile(bytes: Uint8Array<ArrayBuffer>): Promise<{ ref: FileRef; body: Uint8Array<ArrayBuffer> }> {
  const base = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', bytes), 'HKDF', false, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: AAD }, base, 256));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: NONCE, additionalData: AAD }, key, bytes));
  const body = new Uint8Array(1 + sealed.length);
  body[0] = FORMAT;
  body.set(sealed, 1);
  return { ref: { id: await fileId(body), key: toBase64(raw) }, body };
}

export async function fileId(body: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// null means the body cannot be read: an unknown format, or a body that is not the file the key was made from.
export async function openFile(ref: FileRef, body: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (body[0] !== FORMAT) return null;
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64(ref.key), 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: NONCE, additionalData: AAD }, key, body.subarray(1)));
  } catch {
    return null;
  }
}
