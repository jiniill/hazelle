import { useEffect, useState } from 'react';
import { resolveConnection } from '../../connectors/registry';
import type { Account, Connection, Meter, MeterReset, MeterUnit } from '../../connectors/types';
import type { MetersResult } from '../../runtime/meters';
import { metersKey } from '../../runtime/pool';
import { pace, verdict } from '../../model/pace';
import { ACTS } from '../common/acts';
import { describeMetersFailure } from '../common/failure';
import { creditAmount, usd } from '../common/money';
import { monthDay } from '../common/time';
import { count } from '../common/typedNumber';
import { LOADING } from '../common/words';
import { useSession } from '../session';
import { Callout, Empty, Gauge, Link, Panel, Stack, Text } from '../ui';

const RESETS: Record<Exclude<MeterReset, { at: number }>, string> = { daily: '매일 초기화', weekly: '매주 초기화', monthly: '매달 초기화' };
const reset = (resets: MeterReset) => (typeof resets === 'string' ? RESETS[resets] : `${monthDay(resets.at)} 초기화`);

const plain = (value: number) => (value >= 10 ? count(Math.round(value)) : creditAmount(value));
const UNITS: Record<Exclude<MeterUnit, 'usd'>, string> = { credit: ' 크레딧', requests: '회', tokens: ' 토큰', concurrency: '', percent: '%' };
const figure = (unit: MeterUnit, value: number) => (unit === 'usd' ? usd(value) : `${plain(value)}${UNITS[unit]}`);
const amount = (unit: MeterUnit, value: number) => (unit === 'usd' || unit === 'percent' ? figure(unit, value) : plain(value));

function remaining(meter: Extract<Meter, { kind: 'left' }>) {
  const left = amount(meter.unit, meter.amount);
  if (meter.limit === null) return { amount: left, of: '남음' };
  return { amount: left, of: meter.unit === 'percent' ? '남음' : `/ ${figure(meter.unit, meter.limit)} 남음`, share: (meter.limit - meter.amount) / meter.limit };
}

// The first allowance left, without a pace: a pace needs the account's turn, which a summary of the connection lacks.
export function LeftGauge({ result }: { result: MetersResult }) {
  const meter = result.meters.find((entry) => entry.kind === 'left');
  if (!meter) return null;
  return meter.amount <= 0 ? <Gauge {...remaining(meter)} tone="warn" status="소진" /> : <Gauge {...remaining(meter)} />;
}

const VERDICT = { fast: { status: '빠르게 쓰는 중', tone: 'accent' }, even: { status: '적정', tone: 'plain' }, slow: { status: '소진 빠름', tone: 'plain' } } as const;

// turn: the window its group serves, for an account in a pool. waiting: its group's turn has not come. labeled: false
// where the place above names the allowance already.
export function MeterGauge({ meter, turn = null, waiting = false, labeled = true }: { meter: Meter; turn?: { start: number; end: number } | null; waiting?: boolean; labeled?: boolean }) {
  if (meter.kind === 'spent') return <Gauge label={meter.label} amount={amount(meter.unit, meter.amount)} of="사용" />;
  const label = labeled ? (meter.resets ? `${meter.label} · ${reset(meter.resets)}` : meter.label) : undefined;
  const left = remaining(meter);
  if (meter.limit === null) return <Gauge label={label} {...left} />;
  if (meter.amount <= 0) {
    const back = meter.resets === null ? undefined : reset(meter.resets);
    return <Gauge label={label} {...left} tone="warn" status="소진" note={back} />;
  }
  if (waiting) return <Gauge label={label} {...left} status="차례 전" />;
  const paced = pace(meter, Date.now(), turn);
  if (!paced) return <Gauge label={label} {...left} />;
  const { status, tone } = VERDICT[verdict(paced)];
  const note = `${paced.endsAtSwitch ? '차례 끝까지' : '초기화까지'} 하루 ${figure(meter.unit, paced.perDay)}씩`;
  return <Gauge label={label} {...left} mark={paced.even / 100} status={status} tone={tone} note={note} />;
}

// An account's meters as the pool holds them (runtime/pool), so the pick reads what is shown. null while they load.
export function useMeters(connection: Connection, account: Account): { result: MetersResult | null; retry: () => void } {
  const { credentials } = useSession();
  const [result, setResult] = useState<MetersResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = metersKey(connection, account);
  useEffect(() => {
    let current = true;
    setResult(null);
    void credentials.pool.meters(connection, account, { fresh: attempt > 0 })?.then((loaded) => current && setResult(loaded));
    return () => {
      current = false;
    };
    // The stored object is replaced on every sync; only a change to its address or key asks again.
  }, [key, attempt]);
  return { result, retry: () => setAttempt((held) => held + 1) };
}

export function ConnectionMeters({ connection, level }: { connection: Connection; level: 2 | 3 }) {
  const type = resolveConnection(connection)?.type;
  if (!type?.meters && !type?.usagePage) return null;
  return (
    <Panel title="사용량과 한도" level={level}>
      {type.meters && <Figures connection={connection} account={connection.accounts[0]!} />}
      {type.usagePage && <Link href={type.usagePage}>사용량 페이지</Link>}
    </Panel>
  );
}

function Figures({ connection, account }: { connection: Connection; account: Account }) {
  const { result, retry: again } = useMeters(connection, account);
  const retry = { label: ACTS.retry.label, onClick: again };
  if (!result) return <Text variant="note">{LOADING}</Text>;
  const [failure] = result.failures;
  if (!result.meters.length) {
    return failure ? <Callout tone="warn" action={retry}>{describeMetersFailure(failure)}</Callout> : <Empty variant="section">사용량 정보가 없어요.</Empty>;
  }
  return (
    <>
      <Stack gap="group">
        {result.meters.map((meter) => (
          <MeterGauge key={`${meter.kind}:${meter.label}`} meter={meter} />
        ))}
      </Stack>
      {failure && <Callout tone="warn" action={retry}>사용량 일부를 불러오지 못했어요.</Callout>}
    </>
  );
}
