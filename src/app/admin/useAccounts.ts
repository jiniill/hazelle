import { readAccounts, readAdminAccount } from '../../runtime/admin';
import { HEAD_ROWS, usePages } from '../common/useLoaded';
import { useToast } from '../toast';

// Refresh flagged-only head after any act; a newly flagged row may not be loaded.
// Whole-list actions refresh only the target (null removes), preserving fetched pages.
export function useAccounts(head: boolean) {
  const toast = useToast();
  const pages = usePages((after) => readAccounts(after, head ? { flagged: true, limit: HEAD_ROWS } : {}));

  async function refresh(id: string) {
    if (!pages.rows?.some(({ accountId }) => accountId === id)) return;
    const answer = await readAdminAccount(id);
    if (!answer.ok) return toast.failed(answer, '계정을 다시 불러오지 못했어요.');
    const account = answer.data.account;
    pages.update((rows) => rows.flatMap((row) => (row.accountId === id ? (account ? [account] : []) : [row])));
  }

  function acted(id?: string) {
    if (head) pages.reload();
    else if (id) void refresh(id);
  }

  return { ...pages, head, acted };
}
