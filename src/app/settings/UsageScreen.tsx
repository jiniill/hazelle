import { useMemo, useState } from 'react';
import { cacheSaving } from '../../connectors/pricing';
import { costUnit, resolveConnection } from '../../connectors/registry';
import { presenceReport, type PresenceReport } from '../../model/presence';
import { GONE, usageReport, type Counted, type ModelUsage, type ReportWindow, type UsageGroup, type UsageReport } from '../../model/usage';
import { money } from '../common/money';
import { particleOf } from '../common/particles';
import { monthDay } from '../common/time';
import { count } from '../common/typedNumber';
import { spent, tally } from '../common/usage';
import { NO_CHARACTER, PAGES, deletedOf, THINGS, SPANS, UNKNOWN_USE, USAGE_FAILED, USE_NAMES } from '../common/words';
import { LedgerWait, PurposesWait, useLedger, usePurposes } from '../common/useLedger';
import { useConnections, useLibrary, usePresence } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Breakdown, Columns, DayMap, Facts, HourDial, HourMap, Intro, LinkScope, Moment, NavBar, Ranking, Screen, Section, Stack, Table, Tabs, Text, WeekBars, quartileLevels, type DayCell, type Ranked } from '../ui';

const WINDOWS: ReportWindow[] = ['month', 'year', 'all'];
const DAY = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
const WEEKDAYS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour}시`);
const SCALE = { low: '적게', high: '많이' };

const hourWord = (hour: number) => (hour < 6 ? `새벽 ${hour || 12}시` : hour < 12 ? `오전 ${hour}시` : hour < 18 ? `오후 ${hour === 12 ? 12 : hour - 12}시` : hour < 21 ? `저녁 ${hour - 12}시` : `밤 ${hour - 12}시`);
const replies = (calls: number) => `응답 ${count(calls)}번`;
const brief = (usage: ModelUsage) => (usage.costs.length ? `${replies(usage.calls)} · ${spent(usage)}` : replies(usage.calls));
const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
const minutesWord = (minutes: number) => `${count(minutes)}분`;

export function UsageScreen({ back }: { back: Back | null }) {
  const library = useLibrary();
  const connections = useConnections();
  const [window, setWindow] = useState<ReportWindow>('month');
  const { view, retry } = useLedger();
  // At today's catalog price, so an estimate; a model no catalog prices saves nothing it can say.
  const saving = useMemo(() => {
    const priced = new Map(connections.map(({ id, value }) => [id, { unit: costUnit(resolveConnection(value)?.type ?? null), prices: new Map(value.starred.map(({ id: model, price }) => [model, price])) }]));
    return ({ call }: Counted) => {
      const connection = priced.get(call.connection);
      const price = connection?.prices.get(call.model);
      return connection && price ? cacheSaving(price, call.usage, connection.unit) : null;
    };
  }, [connections]);
  const [now] = useState(Date.now);
  const report = useMemo(() => (view.kind === 'read' ? usageReport(view.calls, window, now, (id) => library.byCharacter.has(id), saving) : null), [view, window, now, library, saving]);
  const presence = usePresence();
  const present = useMemo(() => (report ? presenceReport(presence.map(({ value }) => value), report.days[0]!.key) : null), [presence, report]);
  const characterName = (id: string | null) => (id === null ? NO_CHARACTER : id === GONE ? deletedOf(THINGS.character.noun) : library.byCharacter.get(id)!.character.card.name);

  return (
    <Screen width="form" top={<NavBar title={PAGES.usage} {...backBar(back)} />}>
      <Tabs label="기간" items={WINDOWS.map((value) => ({ value, label: SPANS[value] }))} value={window} onChange={setWindow} />
      {view.kind !== 'read' ? (
        <LedgerWait view={view} retry={retry} failed={USAGE_FAILED} />
      ) : (
        <LinkScope>
          <Hero report={report!} present={present!} window={window} now={now} characterName={characterName} />
          {report!.total.calls > 0 && (
            <>
              <Highlights report={report!} />
              <Spending report={report!} />
              <Section title="요일과 시간">
                <HourMap
                  label="요일과 시간별 응답"
                  hours={HOURS}
                  scale={SCALE}
                  {...(present!.present > 0 && { note: `접속한 날 평균 ${minutesWord(Math.round(present!.minutes / present!.present))} 머물렀어요` })}
                  rows={report!.hours.map((cells, weekday) => ({
                    label: WEEKDAYS[weekday]![0]!,
                    keys: [`row:${weekday}`],
                    links: [`row:${weekday}`],
                    cells: cells.map((calls, hour) => ({ value: calls, title: `${WEEKDAYS[weekday]} ${hourWord(hour)}`, note: replies(calls), keys: [`row:${weekday}`, `col:${hour}`], links: [`dial:${hour}`] })),
                  }))}
                />
              </Section>
              <Characters report={report!} characterName={characterName} />
              <Section title="모델">
                <Table
                  label="모델별 사용량"
                  columns={[{ label: '모델', track: 'name' }, { label: '응답', track: 'figure' }, { label: '캐시 적중', track: 'figure' }, { label: '비용', track: 'figure' }]}
                  rows={report!.models.map(({ key, modelName, source, usage }) => ({
                    key,
                    cells: [`${modelName} · ${source}`, `${count(usage.calls)}번`, usage.cache.input ? percent(usage.cache.read, usage.cache.input) : null, usage.costs.length ? spent(usage) : null],
                    summary: [`${count(usage.calls)}번`, ...(usage.cache.input ? [`캐시 ${percent(usage.cache.read, usage.cache.input)}`] : []), ...(usage.costs.length ? [spent(usage)] : [])].join(' · '),
                  }))}
                />
              </Section>
              <Uses report={report!} />
              <Section title="숫자로">
                <Facts
                  variant="tiles"
                  items={[
                    { label: '받은 응답', value: `${count(report!.total.calls)}번` },
                    { label: '대화한 채팅', value: `${count(report!.chats)}개` },
                    { label: '함께한 캐릭터', value: `${count(report!.characters.filter(({ key }) => key !== null && key !== GONE).length)}명` },
                    { label: '입력 토큰', value: tally(report!.total.input, report!.total.calls) },
                    { label: '출력 토큰', value: tally(report!.total.output, report!.total.calls) },
                  ]}
                />
              </Section>
            </>
          )}
        </LinkScope>
      )}
    </Screen>
  );
}

function Hero({ report, present, window, now, characterName }: { report: UsageReport; present: PresenceReport; window: ReportWindow; now: number; characterName: (id: string | null) => string }) {
  const { days, active, current, longest, busiest, total } = report;
  const today = new Date(now).setHours(0, 0, 0, 0);
  const shown = days.filter(({ key }) => key <= today);
  const levels = quartileLevels(shown.map(({ usage }) => usage.calls));
  const within = (key: number, streak: UsageReport['current']) => streak !== null && key >= streak.from && key <= streak.to;
  const cell = ({ key, usage }: UsageGroup<number>, index: number): DayCell => {
    const keys = [`day:${key}`, usage.calls ? 'day:lit' : 'day:none'];
    if (within(key, current)) keys.push('day:current');
    if (within(key, longest)) keys.push('day:longest');
    if (busiest && key === busiest.day.key) keys.push('day:busiest');
    const minutes = present.days.get(key);
    if (minutes) keys.push('day:present');
    const note = [usage.calls ? brief(usage) : '대화하지 않았어요', ...(minutes ? [`${minutesWord(minutes)} 접속`] : [])].join(' · ');
    return { level: key > today ? null : levels[index]!, title: key === today ? '오늘' : DAY.format(key), note, keys, today: key === today };
  };
  const cells = days.map(cell);
  const years = window === 'all' ? [...new Set(days.map(({ key }) => new Date(key).getFullYear()))] : [];
  const top = report.characters.find(({ key }) => key !== null && key !== GONE);
  // The page counting now starts the record when nothing is kept yet.
  const counted = present.first ?? today;
  const span = window === 'month' ? `${new Date(now).getMonth() + 1}월에는` : window === 'year' ? '올해는' : '지금까지';
  return (
    <Stack gap="group">
      {total.calls ? (
        <Intro variant="story" title={`${span} ${count(active)}일, 헤이젤에서 이야기했어요.`}>
          {top && `가장 오래 함께한 건 ${characterName(top.key)}${particleOf(characterName(top.key), '이에요/예요')}.`}
        </Intro>
      ) : (
        <Intro variant="story" title="이 기간에는 아직 대화하지 않았어요." />
      )}
      {window === 'all' ? (
        years.map((year) => {
          const start = new Date(year, 0, 1).getTime();
          const from = days.findIndex(({ key }) => key >= start);
          const to = days.findIndex(({ key }) => key >= new Date(year + 1, 0, 1).getTime());
          return (
            <Stack key={year} gap="related">
              <Text variant="note">{`${year}년`}</Text>
              <DayMap key={`${window}-${year}`} label={`${year}년 대화한 날`} layout="year" start={start} days={cells.slice(from, to === -1 ? undefined : to)} scale={SCALE} />
            </Stack>
          );
        })
      ) : (
        <DayMap key={window} label="대화한 날" layout={window} start={days[0]!.key} days={cells} scale={SCALE} />
      )}
      {total.calls > 0 && (
        <Facts
          variant="figures"
          items={[
            { label: '대화한 날', value: `${count(active)}일`, links: ['day:lit'] },
            { label: '지금 연속', value: `${count(current?.days ?? 0)}일`, links: ['day:current'] },
            { label: '가장 긴 연속', value: `${count(longest?.days ?? 0)}일`, links: ['day:longest'] },
            { label: '접속 시간', value: present.minutes < 60 ? minutesWord(present.minutes) : `${count(Math.round(present.minutes / 60))}시간`, notes: counted > days[0]!.key ? [`${monthDay(counted)}부터`] : [], links: ['day:present'] },
          ]}
        />
      )}
    </Stack>
  );
}

function Highlights({ report }: { report: UsageReport }) {
  const { hours, busiest, total, active } = report;
  const byHour = Array.from({ length: 24 }, (_, hour) => hours.reduce((sum, row) => sum + row[hour]!, 0));
  const peakHour = byHour.indexOf(Math.max(...byHour));
  let peak = { weekday: 0, hour: 0, calls: -1 };
  hours.forEach((row, weekday) => row.forEach((calls, hour) => { if (calls > peak.calls) peak = { weekday, hour, calls }; }));
  const night = [21, 22, 23, 0, 1].reduce((sum, hour) => sum + byHour[hour]!, 0);
  const usual = total.calls / active;
  return (
    <Columns min="wide">
      <Moment label="자주 오는 때" value={<>{WEEKDAYS[peak.weekday]}<br />{hourWord(peak.hour)}</>} note={`밤 9시부터 새벽 2시 전까지 ${percent(night, total.calls)}`} links={[`row:${peak.weekday}`, `dial:${peak.hour}`]}>
        <HourDial label="시간대별 응답" peak={peakHour} hours={byHour.map((calls, hour) => ({ value: calls, title: hourWord(hour), note: replies(calls), keys: [`dial:${hour}`], links: [`dial:${hour}`, `col:${hour}`] }))} />
      </Moment>
      {busiest && (
        <Moment label="가장 바빴던 날" value={DAY.format(busiest.day.key)} note={`${replies(busiest.day.usage.calls)} · 평소의 ${(busiest.day.usage.calls / usual).toFixed(1)}배`} links={['day:busiest']}>
          <WeekBars
            label="그 주의 응답"
            days={busiest.week.map(({ key, usage }, index) => ({ value: usage.calls, label: WEEKDAYS[index]![0]!, title: DAY.format(key), note: replies(usage.calls), keys: [`week:${index}`], links: [`day:${key}`, `week:${index}`], current: key === busiest.day.key }))}
          />
        </Moment>
      )}
    </Columns>
  );
}

function Spending({ report }: { report: UsageReport }) {
  const { total, saved } = report;
  const lead = total.costs.find(({ unit }) => unit === 'usd') ?? total.costs[0];
  const kept = lead && saved.find(({ unit }) => unit === lead.unit);
  const others = total.costs.filter((cost) => cost !== lead);
  const whole = lead && kept ? lead.amount + kept.amount : 0;
  return (
    <Section title="비용">
      {lead && (
        <Breakdown
          total={{ label: '쓴 돈', value: `${lead.estimated ? '약 ' : ''}${money(lead.unit, lead.amount)}` }}
          shares={kept && whole ? [lead.amount / whole, kept.amount / whole] : null}
          parts={[
            { label: '쓴 돈', value: money(lead.unit, lead.amount), mark: 'plain' },
            ...(kept ? [{ label: '캐시로 아낀 돈', value: `약 ${money(kept.unit, kept.amount)}`, mark: 'striped' as const }] : []),
          ]}
        />
      )}
      <Facts
        variant="tiles"
        items={[
          ...(total.cache.input ? [{ label: '캐시 적중률', value: percent(total.cache.read, total.cache.input), notes: [`입력 토큰 ${count(total.cache.input)} 중 ${count(total.cache.read)}`] }] : []),
          ...(lead && kept ? [{ label: '캐시가 없었다면', value: `약 ${money(lead.unit, whole)}` }] : []),
          ...others.map(({ unit, amount, estimated }) => {
            const save = saved.find((each) => each.unit === unit);
            return { label: unit === 'credit' ? '크레딧' : '달러', value: `${estimated ? '약 ' : ''}${money(unit, amount)}`, notes: save ? [`약 ${money(unit, save.amount)} 아낌`] : [] };
          }),
          ...(total.costUnknown ? [{ label: '비용을 모르는 응답', value: `${count(total.costUnknown)}번`, tone: 'muted' as const }] : []),
        ]}
      />
    </Section>
  );
}

function Characters({ report, characterName }: { report: UsageReport; characterName: (id: string | null) => string }) {
  const library = useLibrary();
  const { characters, total } = report;
  const most = characters[0]?.usage.calls ?? 0;
  const named = characters.filter(({ key }) => key !== null && key !== GONE);
  const items = [...named, ...characters.filter(({ key }) => key === null || key === GONE)].map(({ key, usage }): Ranked => {
    const rank = named.findIndex((each) => each.key === key);
    const shelf = key === null || key === GONE ? null : library.byCharacter.get(key)!;
    return {
      key: key ?? 'none',
      rank: rank === -1 ? null : rank + 1,
      name: characterName(key),
      note: `${percent(usage.calls, total.calls)}${usage.costs.length ? ` · ${spent(usage)}` : ''}`,
      value: replies(usage.calls),
      share: most ? usage.calls / most : 0,
      ...(shelf && { face: { face: shelf.character.card.name, ...(shelf.face && { image: shelf.face }) } }),
    };
  });
  return (
    <Section title="함께한 캐릭터">
      <Ranking label="캐릭터별 응답" variant="podium" items={items} />
    </Section>
  );
}

function Uses({ report }: { report: UsageReport }) {
  const filled = usePurposes();
  const { uses, total } = report;
  return (
    <Section title="쓰임">
      {filled ? (
        <Breakdown
          shares={uses.map(({ usage }) => usage.calls / total.calls)}
          parts={uses.map(({ key, usage }) => ({
            label: key === null ? UNKNOWN_USE : USE_NAMES[key],
            value: `${percent(usage.calls, total.calls)} · ${count(usage.calls)}번`,
            mark: key === 'reply' ? 'accent' : key === null ? 'outline' : 'plain',
          }))}
        />
      ) : (
        <PurposesWait />
      )}
    </Section>
  );
}
