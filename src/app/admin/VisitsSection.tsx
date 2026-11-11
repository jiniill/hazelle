import { GUESTS_PER_ADDRESS, PULSE_DAYS_SHOWN, VISITORS_PER_ADDRESS, type PulseDay, type VisitCohorts } from '../../contracts/admin';
import { PULSE_FLOORS } from '../../contracts/pulse';
import { readVisits } from '../../runtime/service/admin';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { Bars, Empty, Panel, Table, type TableColumn } from '../ui';
import { seoulDate, seoulMonthDay } from './seoul';

const OPENED = '손님 방문';
const CONNECTED = '손님 연결';
const GUESTS = '손님 응답';
const CONVERTED = '손님 출신';
const FIRST_PAGE = '첫 페이지';
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
const FIRST_PAGE_COLUMNS: TableColumn[] = [
  { label: '날짜', track: 'fill' },
  { label: '열람', track: 'figure' },
  { label: '예시 대화', track: 'figure' },
  { label: '체험', track: 'figure' },
  { label: '키 입력', track: 'figure' },
  { label: '앱 입장', track: 'figure' },
];
const FIRST_PAGE_HELP = '첫 페이지를 연 사람이 어디까지 갔는지 집계해요. 같은 날 같은 IP 주소는 단계마다 한 번만 세요.';
const COHORTS_HELP = `가입 주별로 각 주에 앱을 연 사람 수만 집계해요. 계정은 저장하지 않아요. ${PULSE_FLOORS.row}명 미만이면 숫자를 남기지 않고, 집계 참여를 끈 계정은 제외해요.`;
const UNDER_FLOOR = `${PULSE_FLOORS.row}명 미만`;
const figure = (value: number | null) => (value === null ? UNDER_FLOOR : count(value));
const PEOPLE = '일간 사용자';
const REPLIES = '일간 응답';
const DAILY_NOTE = `최근 ${PULSE_DAYS_SHOWN}일 · 한국 시간`;
const EXCLUDED = `손님과 집계 참여를 끈 계정은 제외하고, ${PULSE_FLOORS.row}명 미만이면 숫자를 남기지 않아요.`;
const DAILY_HELP = {
  people: `그날 앱을 연 계정과 그중 대화 응답을 받은 계정이에요. ${EXCLUDED}`,
  replies: `그날 계정이 받은 대화 응답이에요. ${EXCLUDED}`,
};

function Cohorts({ weeks, rows }: VisitCohorts) {
  if (weeks.length === 0) return <Empty variant="section">집계된 주가 없어요.</Empty>;
  const columns: TableColumn[] = [{ label: '가입 주', track: 'fill' }, { label: '가입', track: 'figure' }, ...weeks.map((week): TableColumn => ({ label: seoulMonthDay(week), track: 'figure' }))];
  return <Table label={COHORTS} columns={columns} rows={rows.map(({ cohort, signed, people }) => {
    const seen = weeks.map((week, index) => (week < cohort ? '' : figure(people[index] ?? null)));
    return {
      key: String(cohort),
      summary: `가입 ${count(signed)} · ${weeks.map((week, index) => `${seoulMonthDay(week)} ${seen[index]}`).filter((_, index) => seen[index]).join(' · ')}`,
      cells: [seoulDate(cohort), count(signed), ...seen],
    };
  })} />;
}

function Daily({ label, days, measure }: { label: string; days: PulseDay[]; measure: (day: PulseDay) => [value: number | null, detail: string] }) {
  if (days.length === 0) return <Empty variant="section">집계된 날이 없어요.</Empty>;
  return <Bars label={label} bars={days.map((day) => {
    const [value, detail] = measure(day);
    return { label: seoulMonthDay(day.day), value: value ?? 0, detail };
  })} />;
}

export function VisitsSection() {
  const loaded = useLoaded(readVisits);
  return (
    <>
      <Panel title={PEOPLE} note={DAILY_NOTE} help={DAILY_HELP.people} action={loaded.refresh}>
        {loaded.loading}
        {loaded.failure}
        {loaded.data && <Daily label={PEOPLE} days={loaded.data.pulse} measure={(day) => [day.people, `사용자 ${figure(day.people)} · 응답 받은 계정 ${figure(day.repliers)}`]} />}
      </Panel>
      <Panel title={REPLIES} note={DAILY_NOTE} help={DAILY_HELP.replies}>
        {loaded.data && <Daily label={REPLIES} days={loaded.data.pulse} measure={(day) => [day.replies, day.replies === null ? `응답 받은 계정 ${UNDER_FLOOR}` : `응답 ${count(day.replies)}`]} />}
      </Panel>
      <Panel title="방문자 통계" note="최근 14일 · 한국 시간" help={HELP}>
        {loaded.data && <Table label="방문자 통계" columns={COLUMNS} rows={loaded.data.days.map((day) => ({
          key: String(day.day),
          summary: `방문자 ${count(day.visitors)} · 손님 ${count(day.opened)}→${count(day.connected)}→${count(day.guests)} · 새 계정 ${count(day.accounts)} · 출신 ${count(day.converted)}`,
          cells: [seoulDate(day.day), count(day.visitors), count(day.opened), count(day.connected), count(day.guests), count(day.accounts), count(day.converted)],
        }))} />}
      </Panel>
      <Panel title={FIRST_PAGE} note="최근 14일 · 한국 시간" help={FIRST_PAGE_HELP}>
        {loaded.data && <Table label={FIRST_PAGE} columns={FIRST_PAGE_COLUMNS} rows={loaded.data.days.map((day) => ({
          key: String(day.day),
          summary: `열람 ${count(day.shown)} → 예시 대화 ${count(day.read)} → 체험 ${count(day.door)} → 키 입력 ${count(day.keyed)} → 앱 입장 ${count(day.entered)}`,
          cells: [seoulDate(day.day), count(day.shown), count(day.read), count(day.door), count(day.keyed), count(day.entered)],
        }))} />}
      </Panel>
      <Panel title={COHORTS} note="최근 4주 · 한국 시간" help={COHORTS_HELP}>
        {loaded.data && <Cohorts {...loaded.data.cohorts} />}
      </Panel>
    </>
  );
}
