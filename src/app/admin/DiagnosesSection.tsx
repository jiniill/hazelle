import { useState } from 'react';
import { AUTO_KEEP_DAYS, type AutoErrorCause, type AutoEvent, type AutoRow } from '../../contracts/auto-diagnosis';
import { readDiagnoses } from '../../runtime/service/admin';
import { count } from '../common/typedNumber';
import { HEAD_ROWS, PagedList, SeeAll, usePages } from '../common/useLoaded';
import { navigate } from '../shell/router';
import { ListItem, Panel, TextField } from '../ui';
import { seoulMonthDay } from './seoul';
import { TURN_FAILED, FEATURE_NAMES, MEMORY_GAP, CACHE_BROKEN } from '../common/words';

export const DIAGNOSES = '자동 진단';
const EVENTS: Record<AutoEvent, string> = {
  'app-error': '앱 오류',
  'page-slow': '화면 끊김',
  'worker-trouble': '워커 오류',
  'evaluation-stuck': '봇 스크립트 멈춤',
  'evaluation-slow': '봇 스크립트 느림',
  'script-stuck': '루아·플러그인 멈춤',
  'turn-failed': TURN_FAILED,
  'memory-failed': `${FEATURE_NAMES.memory} 실패`,
  'memory-gap': MEMORY_GAP,
  'memory-gap-ended': `${MEMORY_GAP} 사라짐`,
  'chat-unopened': '채팅 열기 실패',
  'cache-broken': CACHE_BROKEN,
};
const HELP = '문제별로 그날 겪은 사람 수와 횟수를 보여 줘요. 사람은 날마다 새로 세요.';

const keyOf = ({ day, event, detail, version, place }: AutoRow) => `${day}${event}${detail}${version}${place}`;

export const wordsOf = ({ day, version, event, detail, place, people, times, facts }: AutoRow) => {
  const { cause } = JSON.parse(facts) as { cause?: AutoErrorCause | null };
  return {
    title: EVENTS[event],
    code: detail || undefined,
    tags: [version || '버전 없음'],
    description: [event === 'app-error' && cause && `최근 오류 분류: ${cause}`, place].filter(Boolean).join(' · ') || undefined,
    note: `${seoulMonthDay(day)} · ${count(people)}명 ${count(times)}회`,
  };
};

// head: the newest few, which 운영 shows.
export function DiagnosesSection({ head }: { head: boolean }) {
  const pages = usePages((after) => readDiagnoses(after, head ? { limit: HEAD_ROWS } : {}));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel
      title={DIAGNOSES}
      note={`최근 ${AUTO_KEEP_DAYS}일`}
      help={HELP}
      action={head ? !pages.whole && <SeeAll onClick={() => navigate({ kind: 'admin-list', list: 'diagnoses' })} /> : pages.refresh}
    >
      <PagedList pages={pages} head={head} label={DIAGNOSES} empty="받은 진단이 없어요.">
        {(row) => {
          const key = keyOf(row);
          return (
            <ListItem
              key={key}
              {...wordsOf(row)}
              expanded={open === key}
              onClick={() => setOpen(open === key ? null : key)}
              detail={open === key && <TextField label="가장 최근 보고" lines={10} value={JSON.stringify(JSON.parse(row.facts), null, 1)} onChange={() => {}} readOnly />}
            />
          );
        }}
      </PagedList>
    </Panel>
  );
}
