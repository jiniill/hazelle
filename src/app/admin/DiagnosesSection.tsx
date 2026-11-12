import { AUTO_KEEP_DAYS, type AutoErrorCause, type AutoEvent, type AutoRow } from '../../contracts/auto-diagnosis';
import { readDiagnoses } from '../../runtime/service/admin';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { Disclosure, Empty, Panel, Stack, TextField } from '../ui';
import { seoulMonthDay } from './seoul';
import { TURN_FAILED, FEATURE_NAMES, MEMORY_GAP, CACHE_BROKEN } from '../common/words';

const EVENTS: Record<AutoEvent, string> = {
  'app-error': '앱 오류',
  'worker-trouble': '워커 오류',
  'evaluation-stuck': '봇 스크립트 멈춤',
  'turn-failed': TURN_FAILED,
  'memory-failed': `${FEATURE_NAMES.memory} 실패`,
  'memory-gap': MEMORY_GAP,
  'memory-gap-ended': `${MEMORY_GAP} 사라짐`,
  'chat-unopened': '채팅 열기 실패',
  'cache-broken': CACHE_BROKEN,
};
const HELP = '문제별로 그날 겪은 사람 수와 횟수를 보여 줘요. 사람은 날마다 새로 세요.';

export const lineOf = ({ day, version, event, detail, place, people, times, facts }: AutoRow) => {
  const { cause } = JSON.parse(facts) as { cause?: AutoErrorCause | null };
  return [seoulMonthDay(day), version || '버전 없음', EVENTS[event], detail, event === 'app-error' && cause && `최근 오류 분류: ${cause}`, place, `${count(people)}명 ${count(times)}회`].filter(Boolean).join(' · ');
};

export function DiagnosesSection() {
  const loaded = useLoaded(readDiagnoses);
  return (
    <Panel title="자동 진단" note={`최근 ${AUTO_KEEP_DAYS}일`} help={HELP} action={loaded.refresh}>
      {loaded.loading}
      {loaded.failure}
      {loaded.data && loaded.data.rows.length === 0 && <Empty variant="section">받은 진단이 없어요.</Empty>}
      {loaded.data && (
        <Stack gap="related">
          {loaded.data.rows.map((row) => (
            <Disclosure key={`${row.day}${row.event}${row.detail}${row.version}${row.place}`} label={lineOf(row)}>
              <TextField label="가장 최근 보고" lines={10} value={JSON.stringify(JSON.parse(row.facts), null, 1)} onChange={() => {}} readOnly />
            </Disclosure>
          ))}
        </Stack>
      )}
    </Panel>
  );
}
