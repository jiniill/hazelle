import type { AutoRow } from '../../contracts/auto-diagnosis';
import type { BoardSettings } from '../../contracts/board';
import type { AdminAccount, LogRow, Report, Service, ShareVersion, Totals, UsagePage, Visits } from '../../contracts/admin';
import { api, SLOW_ROUTE_WAIT, type ApiResult } from '../api';
import { page } from './pages';

// Only the operator's account (the installation's first signup, server/accounts) passes; any other is answered
// not-admin.

export const readService = () => api<Service>('GET', 'admin/service');
export const readDiagnoses = () => api<{ rows: AutoRow[] }>('GET', 'admin/diagnoses');
export const readVisits = () => api<Visits>('GET', 'admin/visits');
export const setService = (values: Pick<Service, 'signupCap' | 'accountBytesCap' | 'accountFileBytesCap'>) => api<undefined>('PUT', 'admin/service', values);
export const setBackupFolder = (folder: string | null) => api<undefined>('PUT', 'admin/backup-folder', { folder });

// flagged: only the accounts suspended, restoring or leaving.
export const readAccounts = (after: string | null, ask: { flagged?: boolean; limit?: number } = {}) => page<'accounts', AdminAccount>('admin/accounts', 'accounts', after, ask);
export const readAdminAccount = (account: string) => api<{ account: AdminAccount | null }>('GET', `admin/accounts/${account}`);
// readAt: when the first page was read; later pages were read after it.
export type ServiceUsage = Totals & { accounts: number };

// Explicit operator refresh only: bounded pages return totals, never the complete account list.
export async function readServiceUsage(progress: (totals: ServiceUsage) => void, signal: AbortSignal): Promise<ApiResult<ServiceUsage>> {
  let next: string | null = null;
  let total: ServiceUsage | null = null;
  do {
    if (signal.aborted) return { ok: false, error: 'stopped' };
    const page: ApiResult<UsagePage> = await api<UsagePage>('GET', `admin/usage${next === null ? '' : `?after=${encodeURIComponent(next)}`}`, undefined, signal);
    if (!page.ok) return page;
    const read: ServiceUsage = { ...page.data.totals, accounts: page.data.accounts };
    total = total === null ? read : {
      bytes: total.bytes + read.bytes,
      disk: total.disk + read.disk,
      unread: total.unread + read.unread,
      accounts: total.accounts + read.accounts,
      readAt: total.readAt,
    };
    progress(total);
    next = page.data.next;
  } while (next !== null);
  return { ok: true, data: total };
}

// reason: a notice to the account, sent with the suspension.
export const suspend = (account: string, reason: string) => api<undefined>('PUT', `admin/accounts/${account}/suspended`, { suspended: true, reason });
export const liftSuspension = (account: string) => api<undefined>('PUT', `admin/accounts/${account}/suspended`, { suspended: false });
// Plaintext, to one account or, with null, to every account there now.
export const sendNotice = (to: string | null, text: string) => api<undefined>('POST', 'admin/notices', { to, text });
export const setCaps = (account: string, caps: Pick<AdminAccount, 'bytesCap' | 'fileBytesCap'>) => api<undefined>('PUT', `admin/accounts/${account}/caps`, caps);
// Also finishes the deletion of a leaving account.
export const removeAccount = (account: string) => api<undefined>('DELETE', `admin/accounts/${account}`, undefined, undefined, SLOW_ROUTE_WAIT);

// open: only the reports not resolved.
export const readReports = (after: string | null, ask: { open?: boolean; limit?: number } = {}) => page<'reports', Report>('admin/reports', 'reports', after, ask);
export const resolveReport = (id: number) => api<undefined>('POST', `admin/reports/${id}/resolve`);
export const readLog = (after: string | null, ask: { limit?: number } = {}) => page<'log', LogRow>('admin/log', 'log', after, ask);

export const setFileBlocked = (file: string, blocked: boolean) => api<undefined>('PUT', `admin/files/${file}/blocked`, { blocked });

// A report's link holds the key (runtime/export/share).
export const readShareVersions = (share: string) => api<{ versions: ShareVersion[] }>('GET', `admin/shares/${share}`);
// 보류, by a report or directly; 보류 풀기, which marks the share reviewed; 차단, of the version reviewed.
export const holdShare = (share: string) => api<undefined>('POST', `admin/shares/${share}/hold`);
export const releaseShare = (share: string) => api<undefined>('POST', `admin/shares/${share}/release`);
export const blockShare = (share: string, version: number, notice: string, suspend: boolean) => api<undefined>('POST', `admin/shares/${share}/block`, { version, notice, suspend });

export const readBoardSettings = () => api<BoardSettings>('GET', 'admin/board');
export const setBoardGuests = (guests: boolean) => api<undefined>('PUT', 'admin/board', { guests } satisfies BoardSettings);
