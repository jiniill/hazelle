import type { BoardSettings, Status } from './board';

export const MAX_REPORT_LENGTH = 4000;
export const MAX_NOTICE_LENGTH = 2000;

// opened, connected, guests: the guest ids that opened the app, added a connection or got a reply that day (GUEST_STEPS).
export const GUEST_STEPS = ['opened', 'connected', 'replied'] as const;
export type GuestStep = (typeof GUEST_STEPS)[number];
// The first page's visitors per address that day: saw it, came down to the example, came down to the key form, entered a key, went into the app.
export const FIRST_PAGE_STEPS = ['shown', 'read', 'door', 'keyed', 'entered'] as const;
export type FirstPageStep = (typeof FIRST_PAGE_STEPS)[number];
export type VisitDay = { day: number; visitors: number; opened: number; connected: number; guests: number; accounts: number; converted: number } & Record<FirstPageStep, number>;
// weeks: the closed weeks shown, oldest first. people lines up with weeks; null is under PULSE_FLOORS.row.
export type VisitCohorts = { weeks: number[]; rows: { cohort: number; signed: number; people: (number | null)[] }[] };
// A closed day's accounts seen, accounts replied to and their 대화 replies (server/pulse.ts). null is under
// PULSE_FLOORS.row: people alone, repliers and replies together.
export type PulseDay = { day: number; people: number | null; repliers: number | null; replies: number | null };
export const PULSE_DAYS_SHOWN = 90;
// The guest ids one address may add to a day's 손님 응답 (server/limits.ts), a forged count's bound.
export const GUESTS_PER_ADDRESS = 8;
// The browsers one address may add to a day's 방문자 (server/visits.ts).
export const VISITORS_PER_ADDRESS = 32;

export type BackupWarning = 'backup-stale' | 'disk-full';
export type BackupCopyFailure = 'missing' | 'denied' | 'full' | 'failed';
// path: null while none is set. Absent where the installation offers none (server/node.ts).
export type BackupFolder = { path: string | null; failure: BackupCopyFailure | null };
// restoring: held by a restore until it ends. leaving: its deletion stopped before the end; removing it again finishes it.
export type AccountState = 'active' | 'restoring' | 'leaving';

// Phases run in order; from armed onward a restore can only roll forward.
// Undo targets the pre-restore checkpoint; operators restore only from an account report.
export type RestorePhase = 'begun' | 'fenced' | 'checkpointed' | 'targeted' | 'armed' | 'rewound' | 'done' | 'failed' | 'cancelled';
export const BEFORE_ARMED: RestorePhase[] = ['begun', 'fenced', 'checkpointed', 'targeted'];
// Self-restores retain a full checkpoint for a week, so cap their daily count; operator restores are exempt.
export const SELF_RESTORES_PER_DAY = 3;
// A baseline is the account's daily or pre-deploy copy; a checkpoint, its state just before a restore replaced it.
export type SnapshotKind = 'baseline' | 'checkpoint';
export type RestoreAction = 'resume' | 'cancel' | 'finalize';
export type RestoreError = 'too-early' | 'store-unavailable' | 'not-rewound' | 'not-verified' | 'stuck';

// How many days a snapshot, a backup generation and an ended operation's pins last; a finished rewind's undo too.
export const RETENTION_DAYS = 7;
// A restore asks for a time at least this far back, so the snapshot chosen for it lies before the restore's own mark.
export const NEWEST_RESTORE_MINUTES = 10;
// A day less than retention leaves an operation time to choose its target, which is pinned from then on
// (server/backup/snapshots.ts), so nothing expires between choosing it and installing it.
export const OLDEST_RESTORE_DAYS = RETENTION_DAYS - 1;
// How long a resolved report, a settled operator-only post and a log row are kept, as the privacy page says. An open
// report stays whatever its age, and a public post is never forgotten by age.
export const KEEP_YEARS = 1;

// What the operator's screens read (server/admin.ts).

// accounts includes leaving rows until deletion; people excludes them. Null caps mean unlimited.
// pending may double-count reported held shares: use only zero/nonzero.
// Database backups omit daily visitor keys/hashes; backupAgeHours is null before any off-site copy.
export type Service = {
  signupCap: number;
  accountBytesCap: number | null;
  accountFileBytesCap: number | null;
  accounts: number;
  people: number;
  pending: number;
  fileBytes: number;
  links: number;
  databaseBytes: number;
  backupAgeHours: number | null;
  diskFreePercent: number;
  warnings: BackupWarning[];
  backupFolder?: BackupFolder;
};
// An account's own cap: bytes, null for none, or 'default' for the service's.
export type OwnCap = number | null | 'default';
// bytes and disk (what the account's store takes on the server) are null when its store was not read: it did not answer in
// time, or the account is not active.
export type AdminAccount = {
  accountId: string;
  username: string;
  createdAt: number;
  suspended: boolean;
  state: AccountState;
  bytes: number | null;
  disk: number | null;
  fileBytes: number;
  bytesCap: OwnCap;
  fileBytesCap: OwnCap;
};
// The accounts read at readAt; the sums leave out the unread ones.
export type Totals = { bytes: number; disk: number; unread: number; readAt: number };
export type UsagePage = { totals: Totals; accounts: number; next: string | null };
// Reports target shares or board content; accountId/username are null for anonymous reporters.
// Resolve shared/postTitle/commentText from current state, null after deletion.
export type SharedState = { held: boolean; reviewed: boolean; cut: boolean; removed: boolean; ownerId: string | null; ownerName: string | null };
export type Report = {
  id: number;
  accountId: string | null;
  username: string | null;
  text: string;
  createdAt: number;
  resolvedAt: number | null;
  share: string | null;
  shareVersion: number | null;
  link: string | null;
  shared: SharedState | null;
  postId: number | null;
  commentId: number | null;
  postTitle: string | null;
  commentText: string | null;
};
type Named = { username: string };
// error: a stored code, which an older build may have written in words this one does not know.
type RestoreEnd = Named & { operation: number; undoes: number | null; error: string | null };
type HiddenDetail = { reason: string; days: number | null };
// Each action the operator's log names now, and the detail its row carries (server/operator.ts logged).
export type LogDetails = {
  suspend: Named;
  lift: Named;
  'delete-account': Named;
  'set-caps': Named & { bytesCap: OwnCap; fileBytesCap: OwnCap };
  'set-service': Pick<Service, 'signupCap' | 'accountBytesCap' | 'accountFileBytesCap'>;
  'set-board': BoardSettings;
  'set-backup-folder': { folder: string | null };
  // null: to every account.
  'send-notice': Named | null;
  'resolve-report': null;
  'block-file': null;
  'unblock-file': null;
  'hold-share': null;
  'release-share': null;
  'block-share': { version: number };
  'restore-begun': Named & { operation: number; post: number | null; at: number | null; undoes: number | null };
  'restore-done': RestoreEnd;
  'restore-cancelled': RestoreEnd;
  'restore-failed': RestoreEnd;
  'post-status': { status: Status; version: string | null };
  'post-hide': HiddenDetail;
  'post-show': null;
  'post-lock': null;
  'post-unlock': null;
  'post-delete': { title: string };
  'comment-hide': HiddenDetail;
  'comment-show': null;
  'comment-delete': { post: number };
  'guest-block': null;
};
export type LogAction = keyof LogDetails;
// Rows only older builds wrote, kept KEEP_YEARS like the rest; migration 0034 rewrote the ones today's shapes can hold.
type OlderDetails = {
  // A notice that answered an account's report, before the board (migration 0015).
  'send-notice': Named & { report: number };
  // 헤이젤 나우's switch for counting guests, gone with them (migration 0027).
  'set-pulse': { guests: boolean };
};
type Rows<T> = { [A in keyof T]: { id: number; at: number; action: A; target: string; detail: T[A] } }[keyof T];
export type LogRow = Rows<LogDetails> | Rows<OlderDetails>;
// pulse: the last PULSE_DAYS_SHOWN closed days kept, oldest first.
export type Visits = { days: VisitDay[]; cohorts: VisitCohorts; pulse: PulseDay[] };
// A share in any state: its versions, the manifest's file id of each.
export type ShareVersion = { version: number; manifest: string; createdAt: number };

// postId links operator restores to a private report; at null requests undo.
// targetAt stays null until selected; verified means reopened after done; server actions govern phase transitions.
export type Restore = {
  id: number;
  postId: number | null;
  at: number | null;
  undoes: number | null;
  targetAt: number | null;
  phase: RestorePhase;
  verified: boolean;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  canUndo: boolean;
  undoExpiresAt: number | null;
  actions: RestoreAction[];
};
export type RestoreRun = Pick<Restore, 'id' | 'phase' | 'verified' | 'error'>;
// What a restore can land on now, newest first (server/lifecycle restorePoints). at: the time a restore to it asks for.
// takenAt: when the account was in that state.
export type RestorePoint = { at: number; takenAt: number; kind: SnapshotKind };
