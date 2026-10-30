export const MAX_REPORT_LENGTH = 4000;
export const MAX_NOTICE_LENGTH = 2000;

// opened, connected, guests: the guest ids that opened the app, added a connection or got a reply that day (GUEST_STEPS).
export type VisitDay = { day: number; visitors: number; opened: number; connected: number; guests: number; accounts: number; converted: number };
export const GUEST_STEPS = ['opened', 'connected', 'replied'] as const;
export type GuestStep = (typeof GUEST_STEPS)[number];
// weeks: the closed weeks shown, oldest first. people lines up with weeks; null is under PULSE_FLOORS.row.
export type VisitCohorts = { weeks: number[]; rows: { cohort: number; signed: number; people: (number | null)[] }[] };
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
