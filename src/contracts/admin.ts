export const MAX_REPORT_LENGTH = 4000;
export const MAX_NOTICE_LENGTH = 2000;

export type VisitDay = { day: number; visitors: number; guests: number; accounts: number; converted: number };
// The guest ids one address may add to a day's 손님 응답 (server/limits.ts), a forged count's bound.
export const GUESTS_PER_ADDRESS = 8;
// The browsers one address may add to a day's 방문자 (server/visits.ts).
export const VISITORS_PER_ADDRESS = 32;

export type BackupWarning = 'backup-stale' | 'disk-full';
// Why the last pass to a self-host's backup folder failed (server/backup/folder.ts): the folder is gone, refused writing,
// or its disk is full.
export type BackupCopyFailure = 'missing' | 'denied' | 'full' | 'failed';
// path: null while none is set. Absent where the installation offers none (server/node.ts).
export type BackupFolder = { path: string | null; failure: BackupCopyFailure | null };
// restoring: held by a restore until it ends. leaving: its deletion stopped before the end; removing it again finishes it.
export type AccountState = 'active' | 'restoring' | 'leaving';

// A restore rewinds an account's stored objects to a time; an undo rewinds them to just before a restore. The account
// begins one itself, or the operator on a report that account sent. The phases run in order; from armed on, a restore can only go forward.
export type RestorePhase = 'begun' | 'fenced' | 'checkpointed' | 'targeted' | 'armed' | 'rewound' | 'done' | 'failed' | 'cancelled';
export const BEFORE_ARMED: RestorePhase[] = ['begun', 'fenced', 'checkpointed', 'targeted'];
// Each restore keeps its checkpoint, a whole copy of the account, for a week after it ends (server/lifecycle), so an
// account rewinding itself is held to a few a day. The operator's restores are not counted.
export const SELF_RESTORES_PER_DAY = 3;
// A baseline is the account's daily or pre-deploy copy; a checkpoint, its state just before a restore replaced it.
export type SnapshotKind = 'baseline' | 'checkpoint';
export type RestoreAction = 'resume' | 'cancel' | 'finalize';
// Why a restore's run stopped, kept on its row and in the operator's log (server/lifecycle).
export type RestoreError = 'too-early' | 'store-unavailable' | 'not-rewound' | 'not-verified' | 'stuck';
