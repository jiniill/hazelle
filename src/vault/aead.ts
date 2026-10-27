const NONCE_BYTES = 12;

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function encodeText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// Sealed form: nonce ‖ AES-GCM ciphertext. The AAD binds the ciphertext to where it belongs.
export async function sealBytes(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: encodeText(aad) }, key, plaintext);
  const sealed = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
  sealed.set(nonce);
  sealed.set(new Uint8Array(ciphertext), NONCE_BYTES);
  return sealed;
}

// null means the key or the AAD is wrong, or the ciphertext was altered: GCM cannot tell these apart.
export async function openBytes(key: CryptoKey, sealed: Uint8Array<ArrayBuffer>, aad: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(0, NONCE_BYTES), additionalData: encodeText(aad) },
      key,
      sealed.subarray(NONCE_BYTES),
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

export async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string): Promise<string> {
  return toBase64(await sealBytes(key, plaintext, aad));
}

export async function open(key: CryptoKey, sealed: string, aad: string): Promise<Uint8Array<ArrayBuffer> | null> {
  return openBytes(key, fromBase64(sealed), aad);
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

// Keep atob validation; per-character callbacks cost more than decryption across a full account.
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(text);
  const bytes = new Uint8Array(decoded.length);
  for (let at = 0; at < decoded.length; at++) bytes[at] = decoded.charCodeAt(at);
  return bytes;
}
