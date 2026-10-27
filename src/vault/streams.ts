import { encodeText, toBase64 } from './aead';

// Private keys stay inside sealed call markers; the server receives only the public half.
// Keep ECDH/sealing compatible with server/stream-box so any unlocked device can resume.
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

export async function streamKey(): Promise<{ public: string; private: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  return { public: toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), private: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

// null: a frame that does not open, which nothing but a broken or foreign stream gives.
export async function streamOpener(id: string, key: JsonWebKey, hello: Uint8Array<ArrayBuffer>) {
  const mine = await crypto.subtle.importKey('jwk', key, P256, false, ['deriveBits']);
  const theirs = await crypto.subtle.importKey('raw', hello, P256, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine, 256);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const opening = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encodeText(id), info: encodeText('risu-alpha stream') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return async (type: number, seq: number, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> => {
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setUint32(8, seq);
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([type]) }, opening, sealed));
    } catch {
      return null;
    }
  };
}
