import { GUESTS_PER_ADDRESS, VISITORS_PER_ADDRESS } from '../../contracts/admin';
import { readVisits } from '../../runtime/admin';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { Button, Panel, Table, type TableColumn } from '../ui';

const GUESTS = '손님 응답';
const CONVERTED = '손님 출신';
const COLUMNS: TableColumn[] = [
  { label: '날짜', track: 'fill' },
  { label: '방문자', track: 'figure' },
  { label: GUESTS, track: 'figure' },
  { label: '새 계정', track: 'figure' },
  { label: CONVERTED, track: 'figure' },
];
const HELP = `방문자는 같은 날 같은 브라우저와 접속 주소를 한 번만 세요. ${GUESTS}은 그날 AI 답을 한 번 이상 받은 손님, ${CONVERTED}은 새 계정 중 7일 안에 손님으로 답을 받아 본 계정이에요. 접속 주소 하나에서 하루에 방문자는 ${VISITORS_PER_ADDRESS}명, 손님은 ${GUESTS_PER_ADDRESS}명까지만 세요.`;
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

export function VisitsSection() {
  const loaded = useLoaded(readVisits);
  return (
    <Panel title="방문자 통계" note="최근 14일 · 한국 시간" help={HELP} action={<Button variant="ghost" onClick={loaded.reload}>새로고침</Button>}>
      {loaded.loading}
      {loaded.failure}
      {loaded.data && <Table label="방문자 통계" columns={COLUMNS} rows={loaded.data.days.map((day) => ({
        key: String(day.day),
        summary: `방문자 ${count(day.visitors)} · ${GUESTS} ${count(day.guests)} · 새 계정 ${count(day.accounts)} · ${CONVERTED} ${count(day.converted)}`,
        cells: [date.format(day.day), count(day.visitors), count(day.guests), count(day.accounts), count(day.converted)],
      }))} />}
    </Panel>
  );
}
