import { argon2id } from 'hash-wasm';
import { encodeText, open, randomBytes, seal, toBase64 } from './aead';
import { formatRecoveryKey, parseRecoveryKey } from './recovery-key';

export type VaultRecord = { passwordWrap: string; recoveryWrap: string };
export type VaultKey = Uint8Array<ArrayBuffer>;
export type Method = 'password' | 'recovery';
// Server sees only proof; HKDF separates it from the vault-unwrapping key.
export type Credential = { method: Method; proof: string; kek: CryptoKey };

// Fixed in code rather than stored with the account: login derives the proof before the server has
// said anything. Raising them needs a new scheme version that login can ask for.
const KDF = { memorySize: 64 * 1024, iterations: 3, parallelism: 1 };

const wrapAad = (accountId: string, method: Method) => `risu-alpha/vault-key/v2/${accountId}/${method}`;

// Single username normalization used for password salt; the server rejects noncanonical names.
export function canonicalUsername(text: string): string {
  return text.trim().normalize('NFC').toLowerCase();
}

// NFC because the same Korean text can arrive composed or decomposed, depending on the OS and IME.
export async function passwordCredential(username: string, password: string): Promise<Credential> {
  const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', encodeText(`risu-alpha/password-salt/v1/${username}`)));
  const stretched = await argon2id({ password: password.normalize('NFC'), salt, ...KDF, hashLength: 32, outputType: 'binary' });
  return derive('password', new Uint8Array(stretched));
}

export async function recoveryCredential(text: string): Promise<Credential | null> {
  const recovery = parseRecoveryKey(text);
  return recovery && derive('recovery', recovery);
}

export async function createVault(accountId: string, password: Credential, vaultKey: VaultKey = randomBytes(32), recoveryBytes = randomBytes(32)) {
  const recovery = await derive('recovery', recoveryBytes);
  const signup = {
    ...(await wrapWithPassword(accountId, vaultKey, password)),
    recoveryProof: recovery.proof,
    recoveryWrap: await seal(recovery.kek, vaultKey, wrapAad(accountId, 'recovery')),
  };
  return { vaultKey, recoveryKey: formatRecoveryKey(recoveryBytes), signup };
}

export async function wrapWithPassword(accountId: string, vaultKey: VaultKey, password: Credential) {
  return { passwordProof: password.proof, passwordWrap: await seal(password.kek, vaultKey, wrapAad(accountId, 'password')) };
}

export async function openVault(accountId: string, record: VaultRecord, credential: Credential): Promise<VaultKey | null> {
  const wrap = credential.method === 'password' ? record.passwordWrap : record.recoveryWrap;
  return open(credential.kek, wrap, wrapAad(accountId, credential.method));
}

async function derive(method: Method, secret: Uint8Array<ArrayBuffer>): Promise<Credential> {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdf = (use: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encodeText(`risu-alpha ${method} ${use} v1`) });
  const proof = toBase64(new Uint8Array(await crypto.subtle.deriveBits(hkdf('proof'), base, 256)));
  const kek = await crypto.subtle.deriveKey(hkdf('vault'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { method, proof, kek };
}
