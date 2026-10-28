import { encodeText, open, seal } from './aead';
import type { VaultKey } from './keys';

const draftAad = (account: string, draftKey: string) => `risu-alpha/draft/v1/${account}/${draftKey}`;

export async function draftEncryptionKey(vaultKey: VaultKey): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', vaultKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encodeText('risu-alpha drafts v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function sealDraft(key: CryptoKey, account: string, draftKey: string, text: string): Promise<string> {
  return seal(key, encodeText(text), draftAad(account, draftKey));
}

export async function openDraft(key: CryptoKey, account: string, draftKey: string, body: string): Promise<string | null> {
  try {
    const bytes = await open(key, body, draftAad(account, draftKey));
    return bytes === null ? null : new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
