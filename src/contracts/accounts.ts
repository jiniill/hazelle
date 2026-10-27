// Single-account installations use password-only setup/login, never guests or username entry.
// Other installations open as guests; open/full controls signup availability (design F1).
export type Door = { kind: 'setup' } | { kind: 'solo'; username: string } | { kind: 'open' } | { kind: 'full' };
