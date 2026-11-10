import { useEffect, useRef, useState } from 'react';
import { readServiceUsage, type ServiceUsage } from '../../runtime/service/admin';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { count } from '../common/typedNumber';
import { COUNTING } from '../common/words';
import { Button, Callout, Row, Text } from '../ui';
import { moment } from '../common/time';

export function UsageRow() {
  const job = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [totals, setTotals] = useState<ServiceUsage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => () => job.current?.abort(), []);

  async function refresh() {
    const stop = new AbortController();
    job.current = stop;
    setBusy(true);
    setComplete(false);
    setFailure(null);
    setTotals(null);
    const answer = await readServiceUsage(setTotals, stop.signal);
    if (job.current !== stop) return;
    job.current = null;
    setBusy(false);
    setComplete(answer.ok);
    if (!answer.ok && answer.error !== 'stopped') setFailure(describeFailure(answer));
  }

  return (
    <>
      <Row kind="spread">
        {totals
          ? <Text variant="note">전체 사용량 · {count(totals.accounts)}명 확인 · 텍스트 {sizeText(totals.bytes)} · 디스크 {sizeText(totals.disk)} · {moment(totals.readAt)}부터 읽음{busy ? ' · 집계 중' : complete ? '' : ' · 중간 집계'}{totals.unread > 0 ? ` · 읽지 못한 ${count(totals.unread)}명 제외` : ''}</Text>
          : <Text variant="note">전체 사용량 · {busy ? COUNTING : '집계 전'}</Text>}
        {busy
          ? <Button variant="secondary" size="sm" onClick={() => job.current?.abort()}>집계 멈추기</Button>
          : <Button variant="secondary" size="sm" onClick={() => void refresh()}>집계</Button>}
      </Row>
      {failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => void refresh() }}>{failure}</Callout>}
    </>
  );
}
