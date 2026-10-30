import { GUESTS_PER_ADDRESS, VISITORS_PER_ADDRESS, type VisitCohorts } from '../../contracts/admin';
import { PULSE_FLOORS } from '../../contracts/pulse';
import { readVisits } from '../../runtime/admin';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { Button, Empty, Panel, Table, type TableColumn } from '../ui';

const OPENED = '손님 방문';
const CONNECTED = '손님 연결';
const GUESTS = '손님 응답';
const CONVERTED = '손님 출신';
const COHORTS = '가입 주별 재방문';
const COLUMNS: TableColumn[] = [
  { label: '날짜', track: 'fill' },
  { label: '방문자', track: 'figure' },
  { label: OPENED, track: 'figure' },
  { label: CONNECTED, track: 'figure' },
  { label: GUESTS, track: 'figure' },
  { label: '새 계정', track: 'figure' },
  { label: CONVERTED, track: 'figure' },
];
const HELP = `방문자는 같은 날 같은 브라우저와 IP 주소를 한 번만 집계해요. ${OPENED}은 그날 앱을 연 손님, ${CONNECTED}은 그날 연결을 추가한 손님, ${GUESTS}은 그날 AI 응답을 한 번 이상 받은 손님이고, ${CONVERTED}은 신규 계정 중 7일 안에 손님으로 응답을 받아 본 계정이에요. IP 주소당 하루 최대 방문자 ${VISITORS_PER_ADDRESS}명, 손님 ${GUESTS_PER_ADDRESS}명까지만 집계해요.`;
const COHORTS_HELP = `가입 주별로 각 주에 앱을 연 사람 수만 집계해요. 계정은 저장하지 않아요. ${PULSE_FLOORS.row}명 미만이면 숫자를 남기지 않고, 집계 참여를 끈 계정은 제외해요.`;
const UNDER_FLOOR = `${PULSE_FLOORS.row}명 미만`;
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const monthDay = (at: number) => date.format(at).slice(5);

function Cohorts({ weeks, rows }: VisitCohorts) {
  if (weeks.length === 0) return <Empty variant="section">집계된 주가 없어요.</Empty>;
  const columns: TableColumn[] = [{ label: '가입 주', track: 'fill' }, { label: '가입', track: 'figure' }, ...weeks.map((week): TableColumn => ({ label: monthDay(week), track: 'figure' }))];
  return <Table label={COHORTS} columns={columns} rows={rows.map(({ cohort, signed, people }) => {
    const seen = weeks.map((week, index) => (week < cohort ? '' : people[index] === null ? UNDER_FLOOR : count(people[index]!)));
    return {
      key: String(cohort),
      summary: `가입 ${count(signed)} · ${weeks.map((week, index) => `${monthDay(week)} ${seen[index]}`).filter((_, index) => seen[index]).join(' · ')}`,
      cells: [date.format(cohort), count(signed), ...seen],
    };
  })} />;
}

export function VisitsSection() {
  const loaded = useLoaded(readVisits);
  return (
    <>
      <Panel title="방문자 통계" note="최근 14일 · 한국 시간" help={HELP} action={<Button variant="ghost" onClick={loaded.reload}>새로고침</Button>}>
        {loaded.loading}
        {loaded.failure}
        {loaded.data && <Table label="방문자 통계" columns={COLUMNS} rows={loaded.data.days.map((day) => ({
          key: String(day.day),
          summary: `방문자 ${count(day.visitors)} · 손님 ${count(day.opened)}→${count(day.connected)}→${count(day.guests)} · 새 계정 ${count(day.accounts)} · 출신 ${count(day.converted)}`,
          cells: [date.format(day.day), count(day.visitors), count(day.opened), count(day.connected), count(day.guests), count(day.accounts), count(day.converted)],
        }))} />}
      </Panel>
      <Panel title={COHORTS} note="최근 4주 · 한국 시간" help={COHORTS_HELP}>
        {loaded.data && <Cohorts {...loaded.data.cohorts} />}
      </Panel>
    </>
  );
}
