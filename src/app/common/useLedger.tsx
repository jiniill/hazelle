import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SETTINGS_ID } from '../../model/settings';
import type { Counted } from '../../model/usage';
import { useSession, useSettings } from '../session';
import { Callout, Text } from '../ui';
import { ACTS } from './acts';
import { count } from './typedNumber';

type LedgerView = { kind: 'filling' } | { kind: 'fill-failed' } | { kind: 'reading' } | { kind: 'failed' } | { kind: 'read'; calls: Counted[] };

// The ledger's calls, read again whenever a row lands. Until the account's one fill of the calls made before the ledger
// has ended, nothing is read: a total of part of them would look like the whole.
export function useLedger(): { view: LedgerView; retry: () => void } {
  const { store, usage } = useSession();
  const filled = useSettings().ledger === 'filled';
  const filling = useSyncExternalStore(usage.subscribe, usage.filling);
  const revision = useSyncExternalStore(store.subscribe, () => store.revision({ kind: 'ledger', parent: SETTINGS_ID }));
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<Counted[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The ledger a restore brought back may need a fill of its own; a fill that failed waits for 다시 시도.
  useEffect(() => {
    if (!filled && filling === null) void usage.fill();
  }, [usage, filled, filling]);
  useEffect(() => {
    if (!filled) return;
    const abort = new AbortController();
    setFailed(false);
    void usage.read(abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) setRead(result.data);
      else setFailed(true);
    });
    return () => abort.abort();
  }, [usage, filled, revision, attempt]);
  // Kept while nothing it shows changed, so what a screen computes from it is computed again only then.
  const view = useMemo((): LedgerView => {
    if (!filled) return { kind: filling === 'failed' ? 'fill-failed' : 'filling' };
    return failed ? { kind: 'failed' } : read ? { kind: 'read', calls: read } : { kind: 'reading' };
  }, [filled, filling, failed, read]);
  return { view, retry: filled ? () => setAttempt((held) => held + 1) : () => void usage.fill() };
}

// Whether every call's purpose the account can tell is in the ledger. Until the one fill of the purposes older rows lack
// has ended, a breakdown by purpose would show part of them as the whole; it starts once the ledger's own fill has.
export function usePurposes(): boolean {
  const { usage } = useSession();
  const { ledger, purposes } = useSettings();
  const purposing = useSyncExternalStore(usage.subscribe, usage.purposing);
  const filled = purposes === 'filled';
  useEffect(() => {
    if (ledger === 'filled' && !filled && purposing === null) void usage.fillPurposes();
  }, [usage, ledger, filled, purposing]);
  return filled;
}

export function PurposesWait() {
  const { usage } = useSession();
  const purposing = useSyncExternalStore(usage.subscribe, usage.purposing);
  if (purposing === 'failed') return <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => void usage.fillPurposes() }}>쓰임을 모두 세지 못했어요.</Callout>;
  return <Text variant="note">{purposing?.of ? `쓰임을 세는 중… 채팅 ${count(purposing.of)}개 중 ${count(purposing.read)}개` : '쓰임을 세는 중…'}</Text>;
}

// failed: the screen's own words for a read that failed.
export function LedgerWait({ view, retry, failed }: { view: Exclude<LedgerView, { kind: 'read' }>; retry: () => void; failed: string }) {
  const { usage } = useSession();
  const filling = useSyncExternalStore(usage.subscribe, usage.filling);
  if (view.kind === 'fill-failed' || view.kind === 'failed') {
    return <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: retry }}>{view.kind === 'failed' ? failed : '이전 사용량을 모두 불러오지 못했어요.'}</Callout>;
  }
  if (view.kind === 'reading') return <Text variant="note">사용량을 확인하는 중…</Text>;
  return <Text variant="note">{filling && filling !== 'failed' && filling.of ? `지난 사용량을 모으는 중… 채팅 ${count(filling.of)}개 중 ${count(filling.read)}개` : '이전 사용량을 불러오는 중…'}</Text>;
}
