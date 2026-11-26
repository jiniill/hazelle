import { useState } from 'react';
import { MAX_WORK_MINUTES, type ServerWork } from '../../contracts/work';
import { setWork } from '../../runtime/service/admin';
import { describeFailure } from '../common/failure';
import { readCount } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { workSpan, workStart } from '../common/work';
import { ACTIONS } from './actions';
import { Button, Callout, NumberInput, Row, Section, SettingGroup, SettingRow, Text, TextField } from '../ui';

const TITLE = ACTIONS['set-work'];
const START = '시작 시각';
const MINUTES = '예상 시간';
const HELP = '앱을 열어 둔 사람에게 알림을 보내요. 시작 시각부터는 서버에 연결되지 않을 때 작업 중이라고 안내해요. 시작 시각이 지난 뒤 서버가 다시 켜지면 예고가 지워져요.';
const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// The next time the clock reads what was typed.
export function nextAt(typed: string, now: number): number | null {
  const read = CLOCK.exec(typed.trim());
  if (!read) return null;
  const at = new Date(now).setHours(Number(read[1]), Number(read[2]), 0, 0);
  return at > now ? at : new Date(at).setDate(new Date(at).getDate() + 1);
}

export function WorkSection({ work, onSaved }: { work: ServerWork | null; onSaved: () => void }) {
  const [clock, setClock] = useState('');
  const [span, setSpan] = useState('');
  const { busy, failure, run } = useAttempt();
  const now = Date.now();
  const at = nextAt(clock, now);
  const typedMinutes = readCount(span);
  const minutes = typedMinutes !== null && typedMinutes <= MAX_WORK_MINUTES ? typedMinutes : null;

  const save = (next: ServerWork | null) =>
    run(async () => {
      const saved = await setWork(next);
      if (!saved.ok) return describeFailure(saved);
      setClock('');
      setSpan('');
      onSaved();
      return null;
    });

  return (
    <Section
      title={TITLE}
      action={
        <Button variant="secondary" busy={busy} disabled={at === null || minutes === null} onClick={() => void save({ at: at!, minutes: minutes! })}>
          예고하기
        </Button>
      }
    >
      <SettingGroup label={TITLE}>
        <SettingRow
          label={START}
          help={HELP}
          description={at === null ? undefined : `${workStart(at, now)}에 시작`}
          error={clock.trim() && at === null ? '17:00처럼 입력해 주세요.' : undefined}
          control={<TextField label={START} showLabel={false} placeholder="17:00" value={clock} onChange={setClock} />}
        />
        <SettingRow
          label={MINUTES}
          error={span.trim() && minutes === null ? `1에서 ${MAX_WORK_MINUTES} 사이의 정수를 입력해 주세요.` : undefined}
          control={<NumberInput label={MINUTES} unit="분" value={span} invalid={span.trim() !== '' && minutes === null} onChange={setSpan} />}
        />
      </SettingGroup>
      {work ? (
        <Row kind="spread">
          <Text variant="note">{`${workSpan(work, now)} 작업을 예고했어요.`}</Text>
          <Button variant="secondary" busy={busy} onClick={() => void save(null)}>
            예고 취소
          </Button>
        </Row>
      ) : (
        <Text variant="note">예고한 작업이 없어요.</Text>
      )}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Section>
  );
}
