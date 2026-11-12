import { useMemo, useState } from 'react';
import { GONE, usageReport, type ModelUsage, type ReportWindow, type UsageGroup } from '../../model/usage';
import { count } from '../common/typedNumber';
import { spent, tally } from '../common/usage';
import { NO_CHARACTER, PAGES, deletedOf, THINGS, SPANS, USAGE_FAILED } from '../common/words';
import { LedgerWait, useLedger } from '../common/useLedger';
import { SeeAll } from '../common/useLoaded';
import { useChats, useLibrary, useSummaries } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Bars, Empty, Facts, NavBar, Screen, Section, Shares, Tabs } from '../ui';
import { ACTS } from '../common/acts';

const WINDOWS: ReportWindow[] = ['today', 'week', 'month', 'all'];
const CHATS_SHOWN = 10;

const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
const month = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' });

const brief = (usage: ModelUsage) => (usage.costs.length ? `${count(usage.calls)}번 · ${spent(usage)}` : `${count(usage.calls)}번`);

// groups: busiest first, as the report sorts them.
const shares = <G extends UsageGroup<unknown>>(groups: G[], name: (group: G) => string) => {
  const most = groups[0]?.usage.calls ?? 0;
  return groups.map((group) => ({ key: String(group.key), label: name(group), value: brief(group.usage), share: most ? group.usage.calls / most : 0 }));
};

export function UsageScreen({ back }: { back: Back | null }) {
  const library = useLibrary();
  const summaries = useSummaries();
  const keptChats = useChats();
  const [window, setWindow] = useState<ReportWindow>('month');
  const { view, retry } = useLedger();
  const [allChats, setAllChats] = useState(false);
  const titles = useMemo(() => new Map(summaries.map(({ parent, value }) => [parent, value.title])), [summaries]);
  const kept = useMemo(() => new Set(keptChats.map(({ id }) => id)), [keptChats]);
  const report = useMemo(() => view.kind === 'read' ? usageReport(view.calls, window, Date.now(), { chat: (id) => kept.has(id), character: (id) => library.byCharacter.has(id) }) : null, [view, window, kept, library]);
  const characterName = (id: string | null) => (id === null ? NO_CHARACTER : id === GONE ? deletedOf(THINGS.character.noun) : library.byCharacter.get(id)!.character.card.name);
  const chatName = (id: string | null) => (id === null ? '채팅 밖' : id === GONE ? deletedOf(THINGS.chat.noun) : titles.get(id) ?? ACTS.newChat.label);
  const total = report?.total;
  const chats = report?.chats ?? [];

  return (
    <Screen width="form" top={<NavBar title={PAGES.usage} {...backBar(back)} />}>
      <Tabs label="기간" items={WINDOWS.map((value) => ({ value, label: SPANS[value] }))} value={window} onChange={setWindow} />
      <Section title="합계">
        {view.kind !== 'read' ? (
          <LedgerWait view={view} retry={retry} failed={USAGE_FAILED} />
        ) : total?.calls ? (
          <Facts
            variant="tiles"
            items={[
              { label: '응답', value: `${count(total.calls)}번` },
              { label: '입력 토큰', value: tally(total.input, total.calls) },
              { label: '출력 토큰', value: tally(total.output, total.calls) },
              { label: '비용', value: spent(total) },
            ]}
          />
        ) : (
          <Empty variant="section">이 기간에 받은 응답이 없어요.</Empty>
        )}
      </Section>
      {report && total!.calls > 0 && (
        <>
          {window !== 'today' && (
            <Section title={window === 'all' ? '월별' : '날짜별'}>
              <Bars label={window === 'all' ? '월별 응답' : '날짜별 응답'} bars={report.periods.map(({ key, usage }) => ({ label: (window === 'all' ? month : day).format(key), value: usage.calls, detail: brief(usage) }))} />
            </Section>
          )}
          <Section title="모델">
            <Shares items={shares(report.models, ({ modelName, source }) => `${modelName} · ${source}`)} />
          </Section>
          <Section title="캐릭터">
            <Shares items={shares(report.characters, ({ key }) => characterName(key))} />
          </Section>
          {chats.length > 0 && (
            <Section title="채팅" action={chats.length > CHATS_SHOWN ? <SeeAll total={chats.length} open={allChats} onClick={() => setAllChats((open) => !open)} /> : undefined}>
              <Shares items={shares(allChats ? chats : chats.slice(0, CHATS_SHOWN), ({ key }) => chatName(key))} />
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
