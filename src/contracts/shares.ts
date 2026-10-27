// Bump when consent text changes: publishing requires the current version, asking existing sharers again.
export const SHARE_CONSENT = 1;

// A share's id: 12 random bytes in base64url, made by the server.
export const SHARE_ID = /^[A-Za-z0-9_-]{16}$/;
// The files one version names, its pictures; the manifest is apart.
export const MAX_SHARE_FILES = 10_000;
// Links an account holds uncut, versions one link holds, and publishes (links and versions) an account makes an hour.
export const SHARE_LIMITS = { links: 500, versions: 100, publishesPerHour: 60 };
// The full link a report carries: the address with its key.
export const MAX_SHARE_LINK = 300;

// The opt-in embed text, stored unsealed. Never a picture.
export type ShareCover = { name: string; creator: string; line: string };
export const COVER_LENGTH = { name: 100, creator: 100, line: 200 } as const satisfies Record<keyof ShareCover, number>;

export type ShareState = { state: 'live'; version: number; manifest: string; received: number } | { state: 'held' } | { state: 'gone' };
