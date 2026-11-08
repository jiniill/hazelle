import type { AccountState } from './admin';

// Single-account installations use password-only setup/login, never guests or username entry.
// Other installations open as guests; open/full controls signup availability (design F1).
export type Door = { kind: 'setup' } | { kind: 'solo'; username: string } | { kind: 'open' } | { kind: 'full' };

// Null caps mean unlimited; null bytes means unread/restoring.
// fileBytes tracks held files, not files currently referenced by app objects (server/files).
export type Storage = { bytes: number | null; bytesCap: number | null; fileBytes: number; fileBytesCap: number | null };
// accountId: the vault's AAD.
export type SessionFacts = {
  accountId: string;
  username: string;
  admin: boolean;
  suspended: boolean;
  state: Exclude<AccountState, 'leaving'>;
  storage: Storage;
  unreadNotices: number;
  unreadBoard: number;
  localProviders: readonly string[];
};
// What the operator sent, newest first (server/admin notices).
export type Notice = { id: number; text: string; createdAt: number };

export const USERNAME_LENGTH = { min: 2, max: 32 } as const;
// Beside letters and digits. '-' stays last, where the class below reads it as itself.
export const USERNAME_MARKS = '_.-';
export const USERNAME = new RegExp(`^[\\p{L}\\p{N}${USERNAME_MARKS}]{${USERNAME_LENGTH.min},${USERNAME_LENGTH.max}}$`, 'u');
