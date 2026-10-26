import { useState } from 'react';
import { PULSE_FLOORS, PULSE_ROLES, type PulseAnswer, type PulseBoard, type PulseOrder, type PulseRanking, type PulseRole } from '../../contracts/pulse';
import { HOSTED } from '../../contracts/installation';
import { selfHost } from '../../runtime/installation';
import { readPulse, readPulseWeek } from '../../runtime/pulse';
import { LegalNotice } from '../common/LegalNotice';
import { count } from '../common/typedNumber';
import { useLoaded } from '../common/useLoaded';
import { PULSE } from '../common/words';
import { Bars, Brand, ChoiceGroup, Disclosure, Divider, Empty, Facts, Intro, Screen, Ranking, Section, SettingRow, Switch, Tabs } from '../ui';
import { belowNames, clockText, hourDetail, hourText, PULSE_ROLE_NAMES, rankRows, REST, weekText } from './board';

const SPLIT = '제공자별로 보기';
const CURRENT = 'current';

// Says what PulseBefore compares (contracts/pulse.ts); change both together.
const RANKING_HELP = {
  current: `최근 7일간 ${PULSE_FLOORS.row}명 이상(대화는 최근 24시간 내 ${PULSE_FLOORS.row}명 이상) 쓴 모델의 순위예요. 순위 변동은 이전 24시간(대화)이나 1주 전과 비교하며, 집계가 덜 끝났거나 사용자가 ${PULSE_FLOORS.board}명 미만이면 숨겨요. ${PULSE_FLOORS.row}명 미만인 모델은 ${REST}에서 숫자 없이 사용량 순으로 이름만 보여 줘요.`,
  earlier: `해당 주에 ${PULSE_FLOORS.row}명 이상 쓴 모델의 순위예요. 순위 변동은 전주와 비교하며, 전주 집계가 덜 끝났거나 사용자가 ${PULSE_FLOORS.board}명 미만이면 숨겨요. ${PULSE_FLOORS.row}명 미만인 모델은 ${REST}에서 숫자 없이 사용량 순으로 이름만 보여 줘요.`,
};

// main.tsx asks before the account flow, as for /terms: the page reads the same signed in or out.
export function pulsePage(path: string) {
  if (path !== PULSE.path) return null;
  // A self-host's 헤이젤 나우 is hazelle.app's, where its counts go.
  if (selfHost()) {
    location.replace(HOSTED + PULSE.path);
    return <></>;
  }
  return <PulsePage />;
}

function PulsePage() {
  const pulse = useLoaded(readPulse);
  return (
    <Screen width="form" top={<Brand />}>
      <Intro title={PULSE.title} />
      {pulse.loading}
      {pulse.failure}
      {pulse.data && <Answer answer={pulse.data} />}
      <Divider label="" />
      <LegalNotice />
    </Screen>
  );
}

function Answer({ answer }: { answer: PulseAnswer }) {
  if (!answer.board) return <Empty variant="section">최근 7일 동안 집계에 참여한 사람이 {PULSE_FLOORS.board}명이 되면 보여 드려요.</Empty>;
  return <Board board={answer.board} at={answer.at} />;
}

function Board({ board, at }: { board: PulseBoard; at: number }) {
  const [role, setRole] = useState<PulseRole>('chat');
  const [split, setSplit] = useState(false);
  const [week, setWeek] = useState(CURRENT);
  const current = week === CURRENT;
  return (
    <>
      <Facts
        variant="figures"
        items={[
          { label: '최근 24시간 응답', value: `${count(board.replies)}번` },
          { label: '최근 7일 쓴 사람', value: `${count(board.people)}명` },
        ]}
      />
      <Section title="시간별 응답" note={`${clockText(at)} 기준`}>
        <Bars label="시간별 응답" bars={board.hours.map((hour) => ({ label: hourText(hour.at), value: hour.calls.chat, detail: hourDetail(hour.calls) }))} />
      </Section>
      <Section
        title="모델 순위"
        note={!current ? '그 주 쓴 사람 순' : role === 'chat' ? '최근 24시간 응답 순' : '최근 7일 쓴 사람 순'}
        help={current ? RANKING_HELP.current : RANKING_HELP.earlier}
        action={
          board.weeks.length > 0 && (
            <ChoiceGroup
              label="기간"
              layout="menu"
              options={[{ value: CURRENT, label: '최근 7일' }, ...board.weeks.map((from) => ({ value: String(from), label: weekText(from) }))]}
              value={week}
              onChange={setWeek}
            />
          )
        }
      >
        <Tabs label="역할" items={PULSE_ROLES.map((value) => ({ value, label: PULSE_ROLE_NAMES[value] }))} value={role} onChange={setRole} />
        <SettingRow label={SPLIT} control={<Switch label={SPLIT} checked={split} onChange={setSplit} />} />
        {current ? (
          <Standing role={role} split={split} ranking={board.ranking[role]} before={board.before[role]} earlier={false} />
        ) : (
          <EarlierWeek key={week} from={Number(week)} role={role} split={split} />
        )}
      </Section>
    </>
  );
}

function EarlierWeek({ from, role, split }: { from: number; role: PulseRole; split: boolean }) {
  const week = useLoaded((signal) => readPulseWeek(from, signal));
  if (!week.data) {
    return (
      <>
        {week.loading}
        {week.failure}
      </>
    );
  }
  return <Standing role={role} split={split} ranking={week.data.ranking[role]} before={week.data.before[role]} earlier />;
}

function Standing({ role, split, ranking, before, earlier }: { role: PulseRole; split: boolean; ranking: PulseRanking; before: PulseOrder | null; earlier: boolean }) {
  const rows = rankRows(ranking, before, split, earlier);
  const below = belowNames(ranking, split);
  return (
    <>
      {rows.length ? (
        <Ranking label={`${PULSE_ROLE_NAMES[role]} 모델 순위`} items={rows} />
      ) : (
        <Empty variant="section">{earlier ? '순위에 오른 모델이 없었어요.' : '아직 순위에 오른 모델이 없어요.'}</Empty>
      )}
      {below.length > 0 && <Disclosure label={`${REST} ${count(below.length)}개`}>{below.join(' · ')}</Disclosure>}
    </>
  );
}
