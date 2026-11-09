// Risu's encryptBuffer and decryptBuffer (util.ts): AES-GCM under the SHA-256 of a string, with a zero IV and no
// additional data. A preset's fixed string makes it obfuscation; an rcc card's password makes it a lock.
const SEAL = { name: 'AES-GCM', iv: new Uint8Array(12) };

const keyOf = async (secret: string, usage: 'encrypt' | 'decrypt') =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)), 'AES-GCM', false, [usage]);

export const seal = async (data: Uint8Array<ArrayBuffer>, secret: string) => new Uint8Array(await crypto.subtle.encrypt(SEAL, await keyOf(secret, 'encrypt'), data));

// null when the secret does not open it, or the sealed bytes were changed.
export async function unseal(sealed: Uint8Array<ArrayBuffer>, secret: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt(SEAL, await keyOf(secret, 'decrypt'), sealed));
  } catch {
    return null;
  }
}
