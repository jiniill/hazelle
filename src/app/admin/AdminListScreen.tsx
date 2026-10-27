import { readService } from '../../runtime/admin';
import { useLoaded } from '../common/useLoaded';
import { NOTICES } from '../common/words';
import { backBar } from '../shell/router';
import type { AdminList, Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { AccountsSection } from './AccountsSection';
import { LogSection } from './LogSection';
import { ReportsSection } from './ReportsSection';
import { useAccounts } from './useAccounts';

const TITLES: Record<AdminList, string> = { accounts: '계정', reports: NOTICES.received, log: '기록' };

export function AdminListScreen({ list, back }: { list: AdminList; back: Back | null }) {
  return (
    <Screen width="page" top={<NavBar title={TITLES[list]} {...backBar(back)} />}>
      {list === 'accounts' && <AllAccounts />}
      {list === 'reports' && <ReportsSection head={false} />}
      {list === 'log' && <LogSection head={false} />}
    </Screen>
  );
}

function AllAccounts() {
  const service = useLoaded(readService);
  const accounts = useAccounts(false);
  return <AccountsSection loaded={accounts} total={service.data?.accounts ?? null} onActed={service.reload} />;
}
