import { useMemo } from 'react';
import { connectionUsage, type ModelUsage } from '../../model/usage';
import { count } from '../common/typedNumber';
import { tally } from '../common/usage';
import { LedgerWait, useLedger } from '../common/useLedger';
import { Empty, Facts, Panel } from '../ui';
import { SPANS } from '../common/words';

const WINDOWS = ['hour', 'today', 'week'] as const;

const tile = (label: string, usage: ModelUsage) =>
  usage.calls
    ? { label, value: `응답 ${count(usage.calls)}회`, notes: [`입력 ${tally(usage.input, usage.calls)}`, `출력 ${tally(usage.output, usage.calls)}`] }
    : { label, value: '없음', tone: 'muted' as const };

export function ConnectionSent({ connection }: { connection: string }) {
  const { view, retry } = useLedger();
  const usage = useMemo(() => (view.kind === 'read' ? connectionUsage(view.calls, connection, Date.now()) : null), [view, connection]);
  const used = usage && WINDOWS.some((window) => usage[window].calls) ? usage : null;

  return (
    <Panel title="사용 내역">
      {view.kind !== 'read' ? (
        <LedgerWait view={view} retry={retry} failed="사용 내역을 불러오지 못했어요." />
      ) : used ? (
        <Facts variant="figures" items={WINDOWS.map((window) => tile(SPANS[window], used[window]))} />
      ) : (
        <Empty variant="section">이번 주에 이 연결로 받은 응답이 없어요.</Empty>
      )}
    </Panel>
  );
}
