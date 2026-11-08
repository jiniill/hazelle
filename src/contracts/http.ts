// An answer that changed or read an account's counts carries them, so the page holding the account stays current.
export const ACCOUNT_USAGE_HEADERS = { bytes: 'x-account-bytes', fileBytes: 'x-account-file-bytes' } as const;
export const ACCOUNT_HEADER = 'x-account';
// Sync and mark-seen responses carry unread counts so open pages learn of new notices without reload.
export const UNREAD_NOTICES_HEADER = 'x-unread-notices';
// The account's unread 게시판 activity (contracts/board Activity), on the same answers.
export const UNREAD_BOARD_HEADER = 'x-unread-board';
// The page build the server serves, on every API answer, so a page of another build can offer a reload.
// Named for what it once said: a tab of a release from before is told only through this name.
export const BUILD_HEADER = 'x-hazelle-version';
export const RELAY_HEADER = 'x-relay';
// Who answered a relayed call: the provider, or the relay refusing it (RelayError).
export const RELAY_SOURCE = { upstream: 'upstream', error: 'error' } as const;
// A stream's answer that carries its frames (contracts/streams), not a refusal.
export const STREAM_HEADER = 'x-stream';
export const STREAM_FRAMES = 'frames';
// The chat whose bot's script makes a relayed call (an embedding), counted in that chat's cap as its streams are.
export const BOT_HEADER = 'x-hazelle-bot';
// 헤이젤 나우's label (contracts/pulse), sent only while the account shares its usage.
export const PULSE_HEADER = 'x-hazelle-pulse';
// Who sent a request, as the public listener saw it (server/frontend-worker): the key of the per-visitor limits.
export const VISITOR_HEADER = 'x-hazelle-visitor';

// Keep server/http and server/stream-box errors in sync with app/common/failure wording.
export type ServerError =
  | 'account-busy'
  | 'account-leaving'
  | 'account-mismatch'
  | 'account-restoring'
  | 'bad-body'
  | 'bad-content-type'
  | 'bad-id'
  | 'bad-input'
  | 'bad-key'
  | 'bad-nickname'
  | 'bad-post'
  | 'bad-time'
  | 'bad-username'
  | 'busy'
  | 'cache-reset'
  | 'cannot-cancel'
  | 'cannot-undo'
  | 'conflict'
  | 'file-blocked'
  | 'folder-in-data'
  | 'folder-not-absolute'
  | 'folder-unwritable'
  | 'files-full'
  | 'length-required'
  | 'no-consent'
  | 'nickname-taken'
  | 'no-nickname'
  | 'no-session'
  | 'not-admin'
  | 'not-author'
  | 'not-found'
  | 'post-locked'
  | 'server-error'
  | 'share-held'
  | 'signup-closed'
  | 'sole-operator'
  | 'storage-full'
  | 'store-unavailable'
  | 'stream-exists'
  | 'stream-gone'
  | 'suspended'
  | 'too-large'
  | 'too-many-attempts'
  | 'too-many-bot-calls'
  | 'too-many-calls'
  | 'too-many-comments'
  | 'too-many-pictures'
  | 'bad-picture'
  | 'too-many-live-calls'
  | 'too-many-posts'
  | 'too-many-publishes'
  | 'too-many-reports'
  | 'too-many-restores'
  | 'too-many-shares'
  | 'too-many-signups'
  | 'too-many-versions'
  | 'too-many-visits'
  | 'too-many-writes'
  | 'username-taken'
  | 'guest-board-blocked'
  | 'guest-board-closed'
  | 'wrong-login';
// A provider call the relay forwards as given.
export const RELAY_METHODS = ['GET', 'POST'] as const;
export type HttpRequest = { url: string; method: (typeof RELAY_METHODS)[number]; headers: Record<string, string>; body: string | null };
// A keyset page of a list: next is what the following page is asked after, null on the last.
export type Paged<K extends string, T> = Record<K, T[]> & { next: string | null };
// The relay's own refusals, answered marked RELAY_HEADER: error (server/relay).
export type RelayError = 'bad-envelope' | 'not-https' | 'not-public' | 'upstream-unreachable' | 'upstream-redirect' | 'upstream-not-api' | 'relay-traffic-limit' | 'relay-host-limit';
