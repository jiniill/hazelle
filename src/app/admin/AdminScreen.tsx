import { useState } from 'react';
import type { BackupWarning } from '../../contracts/admin';
import { readService, readBoardSettings, setBoardGuests } from '../../runtime/admin';
import { selfHost } from '../../runtime/installation';
import { useAttempt } from '../common/useAttempt';
import { describeFailure } from '../common/failure';
import { PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Beside, Callout, NavBar, Screen, Section, SettingGroup, SettingRow, Switch } from '../ui';
import { AccountsSection } from './AccountsSection';
import { BackupCopierNote, BackupFolderSection } from './BackupFolderSection';
import { LogSection } from './LogSection';
import { OperatorPostsSection } from './OperatorPostsSection';
import { ReportsSection } from './ReportsSection';
import { ServiceSection } from './ServiceSection';
import { useLoaded } from '../common/useLoaded';
import { moderates } from './moderation';
import { useAccounts } from './useAccounts';
import { ToolsSection } from './ToolsSection';
import { UsageRow } from './UsageRow';
import { VisitsSection } from './VisitsSection';

const WARNINGS: Record<BackupWarning, string> = {
  'backup-stale': '백업이 36시간 넘게 없음',
  'disk-full': '디스크 80% 초과',
};

// Refresh log head/counts/flagged accounts after acts; service-wide usage is explicit-refresh only.
// On failed service reads keep every section: unknown cannot imply empty.
// Self-hosts omit hosted community/moderation/visits, which belong to hazelle.app.
export function AdminScreen({ back }: { back: Back | null }) {
  const own = selfHost();
  const service = useLoaded(readService);
  const accounts = useAccounts(true);
  const [acts, setActs] = useState(0);
  const moderating = service.data ? moderates(service.data) : service.failure !== null;
  const shared = service.data ? service.data.people > 1 : service.failure !== null;
  const acted = () => {
    setActs((count) => count + 1);
    service.reload();
  };
  return (
    <Screen width="page" top={<NavBar title={PAGES.admin} {...backBar(back)} />}>
      {service.data?.warnings.map((warning) => <Callout key={warning} tone="warn" alert>{WARNINGS[warning]}</Callout>)}
      {service.failure}
      <Beside side={<LogSection key={acts} head />}>
        {!own && moderating && <ReportsSection head onActed={acted} />}
        {!own && <OperatorPostsSection />}
        {!own && <VisitsSection />}
        {!own && <GuestBoardSection onSaved={acted} />}
        <AccountsSection loaded={accounts} total={service.data?.accounts ?? null} onActed={acted}>
          {shared && <UsageRow />}
        </AccountsSection>
        {service.loading}
        {service.data && <ServiceSection service={service.data} onSaved={acted} />}
        {service.data?.backupFolder && <BackupFolderSection folder={service.data.backupFolder} backupAgeHours={service.data.backupAgeHours} onSaved={acted} />}
        {own && service.data && !service.data.backupFolder && service.data.backupAgeHours === null && <BackupCopierNote />}
        {!own && moderating && <ToolsSection onActed={acted} />}
      </Beside>
    </Screen>
  );
}

function GuestBoardSection({ onSaved }: { onSaved: () => void }) {
  const settings = useLoaded(readBoardSettings);
  const { busy, failure, run } = useAttempt();
  const save = (guests: boolean) =>
    void run(async () => {
      const saved = await setBoardGuests(guests);
      if (!saved.ok) return describeFailure(saved);
      settings.reload();
      onSaved();
      return null;
    });
  return (
    <Section title="게시판">
      {settings.loading}
      {settings.failure}
      {settings.data && (
        <SettingGroup label="게시판">
          <SettingRow
            label="손님 글쓰기"
            help="끄면 손님은 글을 읽기만 할 수 있어요."
            control={<Switch label="손님 글쓰기" checked={settings.data.guests} disabled={busy} onChange={save} />}
          />
        </SettingGroup>
      )}
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
    </Section>
  );
}
