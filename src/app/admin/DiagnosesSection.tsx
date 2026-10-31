import { AUTO_KEEP_DAYS, type AutoEvent, type AutoRow } from '../../contracts/auto-diagnosis';
import { readDiagnoses } from '../../runtime/admin';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { Button, Disclosure, Empty, Panel, Stack, TextField } from '../ui';

const EVENTS: Record<AutoEvent, string> = {
  'app-error': '앱 오류',
  'worker-trouble': '워커 오류',
  'turn-failed': '응답 실패',
  'memory-failed': '장기 기억 실패',
  'memory-gap': '기억에 없음',
  'chat-unopened': '채팅 열기 실패',
};
const HELP = '문제별로 그날 겪은 사람 수와 횟수를 보여 줘요. 사람은 날마다 새로 세요.';
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

const lineOf = ({ day, version, event, detail, place, people, times }: AutoRow) => [date.format(day).slice(5), version || '버전 없음', EVENTS[event], detail, place, `${count(people)}명 ${count(times)}회`].filter(Boolean).join(' · ');

export function DiagnosesSection() {
  const loaded = useLoaded(readDiagnoses);
  return (
    <Panel title="자동 진단" note={`최근 ${AUTO_KEEP_DAYS}일`} help={HELP} action={<Button variant="ghost" onClick={loaded.reload}>새로고침</Button>}>
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
