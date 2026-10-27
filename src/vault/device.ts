import { open, randomBytes, seal } from './aead';
import { cachedDatabase } from './database';
import type { VaultKey } from './keys';

// The vault stays unlocked on this device: the vault key is kept sealed under a non-extractable
// device key, so the stored copy is useless outside this browser profile.
const DB_NAME = 'risu-alpha';
const STORE = 'device';
const DEVICE_KEY = 'device-key';
const VAULTS = 'vaults';

const deviceAad = (accountId: string) => `risu-alpha/device/v1/${accountId}`;

type StoredVault = { accountId: string; sealed: string };
type StoredVaults = { guest?: StoredVault & { signupRecovery?: string }; account?: StoredVault };

export async function rememberVault(accountId: string, vaultKey: VaultKey, guest = false): Promise<void> {
  const key = await deviceKey();
  const stored = { accountId, sealed: await seal(key, vaultKey, deviceAad(accountId)) };
  await changeVaults((vaults) => ({ ...vaults, [guest ? 'guest' : 'account']: stored }));
}

async function deviceKey(): Promise<CryptoKey> {
  const held = await read<CryptoKey>(DEVICE_KEY);
  if (held) return held;
  const made = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const tx = (await database()).transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const found = store.get(DEVICE_KEY);
  let key = made;
  found.onsuccess = () => {
    if (found.result) key = found.result as CryptoKey;
    else store.put(made, DEVICE_KEY);
  };
  await completed(tx);
  return key;
}

// Keep the pending recovery secret device-sealed so retries after an interrupted signup download the same key.
// Remove it with the transferred guest.
export async function guestSignupRecovery(accountId: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await deviceKey();
  const aad = `${deviceAad(accountId)}/signup-recovery`;
  const made = await seal(key, randomBytes(32), aad);
  let stored = '';
  await changeVaults((vaults) => {
    if (vaults.guest?.accountId !== accountId) throw new Error('No guest vault');
    stored = vaults.guest.signupRecovery ?? made;
    return { ...vaults, guest: { ...vaults.guest, signupRecovery: stored } };
  });
  const bytes = await open(key, stored, aad);
  if (!bytes) throw new Error('Unreadable signup recovery key');
  return bytes;
}

export async function recallGuest(): Promise<{ accountId: string; vaultKey: VaultKey } | null> {
  const stored = (await read<StoredVaults>(VAULTS))?.guest;
  if (!stored) return null;
  const vaultKey = await unseal(stored);
  return vaultKey && { accountId: stored.accountId, vaultKey };
}

export async function recallVault(accountId: string): Promise<VaultKey | null> {
  const vaults = await read<StoredVaults>(VAULTS);
  const stored = [vaults?.account, vaults?.guest].find((vault) => vault?.accountId === accountId);
  return stored ? unseal(stored) : null;
}

async function unseal(stored: StoredVault): Promise<VaultKey | null> {
  const key = await read<CryptoKey>(DEVICE_KEY);
  return key ? open(key, stored.sealed, deviceAad(stored.accountId)) : null;
}

// Locking an account must not erase the only key to a guest awaiting the sign-in choice.
export async function lockVault(): Promise<void> {
  await changeVaults(({ guest }) => ({ ...(guest && { guest }) }));
}

export async function forgetGuestVault(accountId: string): Promise<void> {
  await changeVaults((vaults) => vaults.guest?.accountId === accountId ? { ...(vaults.account && { account: vaults.account }) } : vaults);
}

async function changeVaults(change: (vaults: StoredVaults) => StoredVaults): Promise<void> {
  const tx = (await database()).transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const found = store.get(VAULTS);
  found.onsuccess = () => store.put(change((found.result as StoredVaults | undefined) ?? {}), VAULTS);
  await completed(tx);
}

async function read<T>(name: string): Promise<T | undefined> {
  const db = await database();
  return request<T | undefined>(db.transaction(STORE).objectStore(STORE).get(name));
}

const database = cachedDatabase(DB_NAME, 2, (req, event) => {
  const store = event.oldVersion === 0 ? req.result.createObjectStore(STORE) : req.transaction!.objectStore(STORE);
  if (event.oldVersion < 2) {
    const old = store.get('vault');
    old.onsuccess = () => {
      const vault = old.result as (StoredVault & { guest?: true }) | undefined;
      if (vault) store.put({ [vault.guest ? 'guest' : 'account']: { accountId: vault.accountId, sealed: vault.sealed } } satisfies StoredVaults, VAULTS);
      store.delete('vault');
    };
  }
});

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
