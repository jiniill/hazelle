import { encodeText, open, seal, vaultSubkey } from './aead';
import type { VaultKey } from './keys';

const draftAad = (account: string, draftKey: string) => `risu-alpha/draft/v1/${account}/${draftKey}`;

export const draftEncryptionKey = (vaultKey: VaultKey) => vaultSubkey(vaultKey, 'risu-alpha drafts v1');

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
