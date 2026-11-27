import { ArrowRightLeft, Clock, History, ListPlus, PenLine, Scissors, Settings2, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CacheBreak } from '../../model/cache';
import { cacheRead, cacheReport, type CacheReport } from '../../model/cache-report';
import { windowStart, type ReportWindow } from '../../model/usage';
import { cacheMissed } from '../../runtime/diagnostics/cache-diagnosis';
import { breakWord, CAUSES, FATES, PROVIDER_MISSED } from '../common/cache';
import { partName } from '../common/prompt-words';
import { count } from '../common/typedNumber';
import { CacheWait, LedgerWait, useCacheLedger } from '../common/useLedger';
import { useShown } from '../common/useLoaded';
import { useCharacterName } from '../common/usage';
import { CACHE_BROKEN, CACHE_PAGE, CACHE_READ, deletedOf, PAGES, SPANS, THINGS, UNKNOWN } from '../common/words';
import { useCaptured, useLibrary } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Columns, Empty, List, ListItem, Moment, NavBar, NoticeBar, Screen, Section, SendLine, ShareRows, Stack, Tabs, Tag, type ShareRow } from '../ui';

const WINDOWS: ReportWindow[] = ['month', 'year', 'all'];
const PLACES = ['prompts', 'characters', 'chats'] as const;
type Place = (typeof PLACES)[number];
const PLACE_NAMES: Record<Place, string> = { prompts: PAGES.prompts, characters: THINGS.character.noun, chats: THINGS.chat.noun };
const ICONS: Record<CacheBreak['kind'], LucideIcon> = { model: Settings2, account: Settings2, reasoning: Settings2, off: Settings2, expired: Clock, far: ListPlus, changed: PenLine, added: ListPlus, removed: Scissors, moved: ArrowRightLeft };

const COULD = '캐시 가능';

const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
const times = (value: number) => `${count(value)}번`;
const amount = (value: number) => `${count(value)} 토큰`;
const leakName = (cause: CacheBreak) => ('from' in cause ? partName(cause.from, cause.role) : breakWord(cause));

export function CacheScreen({ back }: { back: Back | null }) {
  const [window, setWindow] = useState<ReportWindow>('month');
  const { view, retry, noted, unfilled, caching, fill } = useCacheLedger();
  const [now] = useState(Date.now);
  const names = useNames();
  const report = useMemo(() => noted && cacheReport(noted, window === 'all' ? 0 : windowStart(window, now), ({ call, forecast }) => cacheMissed({ ...call, forecast })), [noted, window, now]);
  return (
    <Screen width="form" top={<NavBar title={CACHE_PAGE} {...backBar(back)} />}>
      <Tabs label="기간" items={WINDOWS.map((value) => ({ value, label: SPANS[value] }))} value={window} onChange={setWindow} />
      {view.kind !== 'read' ? (
        <LedgerWait view={view} retry={retry} failed={`${CACHE_PAGE} 기록을 불러오지 못했어요.`} />
      ) : (
        <>
          {caching ? <CacheWait /> : unfilled > 0 && <NoticeBar icon={History} title="지난 기록" note={`채팅 ${count(unfilled)}개의 기록이 빠져 있어요`} hint={{ label: '지난 기록', text: '예전 채팅의 캐시 기록을 읽어 오는 작업이라 채팅이 많으면 시간이 걸려요.' }} actions={<Button variant="secondary" size="sm" onClick={fill}>지난 기록 읽기</Button>} />}
          {report!.total.calls === 0 ? <Empty>{`이 기간에는 ${CACHE_PAGE} 기록이 없어요.`}</Empty> : <CacheReportView report={report!} names={names} />}
        </>
      )}
    </Screen>
  );
}

// names: what a prompt, a character and a chat are called by their ledger keys; live: whether the chat can be opened.
type Names = Record<Place, (key: string | null) => string> & { live: (chat: string) => boolean };

export function CacheReportView({ report, names }: { report: CacheReport; names: Names }) {
  const { total, leaks, providers, causes } = report;
  const read = cacheRead(total);
  const frequent = leaks.reduce((most, leak) => (leak.times > most.times ? leak : most), leaks[0]!);
  const missing = providers.filter(({ share }) => share.missed > 0);
  return (
    <Stack gap="section">
      <SendLine
        label={`읽을 수 있었던 ${amount(total.of)} 중 ${amount(read)}을 ${CACHE_READ}`}
        figure={String(Math.round((read / total.of) * 100))}
        unit="%"
        caption={CACHE_READ}
        now={`응답 ${times(total.calls)} · 읽을 수 있었던 입력 ${amount(total.of)}`}
        segments={[{ fate: 'read', size: read }, { fate: 'missed', size: total.missed }, { fate: 'again', size: total.broken }]}
        legend={[
          { fate: 'read', label: FATES.read, value: count(read) },
          { fate: 'missed', label: FATES.missed, value: `${count(total.missed)} · ${percent(total.missed, total.of)}` },
          { fate: 'again', label: CACHE_BROKEN, value: `${count(total.broken)} · ${percent(total.broken, total.of)}` },
        ]}
      />
      {leaks.length > 1 && frequent !== leaks[0] && (
        <Columns min="wide">
          <Moment label="가장 크게 새는 곳" value={amount(leaks[0]!.lost)} note={`${leakName(leaks[0]!.cause)} · ${breakWord(leaks[0]!.cause)}`} />
          <Moment label="가장 자주 새는 곳" value={times(frequent.times)} note={`${leakName(frequent.cause)} · ${breakWord(frequent.cause)}`} />
        </Columns>
      )}
      {leaks.length > 0 && <Leaks leaks={leaks} lost={total.broken} names={names} />}
      {missing.length > 0 && (
        <Section title={PROVIDER_MISSED} note={amount(total.missed)} help="캐시를 읽을 수 있는 요청인데 제공자가 읽지 않은 양이라 프롬프트나 설정으로는 고칠 수 없어요.">
          <ShareRows
            label="모델별 캐시 놓침"
            lost="missed"
            columns={['모델', COULD, '놓침', '비율']}
            rows={missing.map(({ connection, model, modelName, source, share }) => {
              const could = share.of - share.broken;
              return { key: `${connection}:${model}`, name: modelName, note: source, kept: 1 - share.missed / could, amount: count(share.missed), rate: percent(share.missed, could) };
            })}
          />
        </Section>
      )}
      <Places report={report} names={names} />
      {causes.length > 0 && (
        <Section title="세부 원인" help="진단 기록이 있는 응답에서 캐시가 깨진 구체적인 원인을 모아 보여 줘요.">
          <List label="세부 원인" box>
            {causes.map(({ kind, name, lost, times: happened }) => (
              <ListItem key={`${kind}:${name}`} title={name ?? CAUSES[kind]} tags={name === null ? [times(happened)] : [CAUSES[kind], times(happened)]} note={amount(lost)} />
            ))}
          </List>
        </Section>
      )}
    </Stack>
  );
}

function Leaks({ leaks, lost, names }: { leaks: CacheReport['leaks']; lost: number; names: Names }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section title={CACHE_BROKEN} note={amount(lost)} help="프롬프트나 로어북 변경, 메시지 수정 등으로 요청이 달라져 다시 보낸 토큰 양이에요.">
      <List label={CACHE_BROKEN} box>
        {leaks.map(({ cause, lost: gone, times: happened, chats }, at) => (
          <ListItem
            key={at}
            leading={<Tag icon={ICONS[cause.kind]} />}
            title={leakName(cause)}
            tags={['from' in cause ? [breakWord(cause)] : [], [times(happened), `평균 ${amount(Math.round(gone / happened))}`]].flat()}
            note={amount(gone)}
            expanded={open === at}
            onClick={() => setOpen(open === at ? null : at)}
            detail={
              open === at && (
                <LeakChats chats={chats} names={names} />
              )
            }
          />
        ))}
      </List>
    </Section>
  );
}

const CHATS = 5;

function LeakChats({ chats, names }: { chats: CacheReport['leaks'][number]['chats']; names: Names }) {
  const shown = useShown(chats, CHATS);
  return (
    <>
      <List label="캐시가 깨진 채팅">
        {shown.rows.map(({ key, lost, times: happened }) => (
          <ListItem key={key} title={names.chats(key)} tags={[times(happened)]} note={amount(lost)} {...(key !== null && names.live(key) && { onClick: () => navigate({ kind: 'chat', id: key }) })} />
        ))}
      </List>
      {shown.more}
    </>
  );
}

function Places({ report, names }: { report: CacheReport; names: Names }) {
  const [place, setPlace] = useState<Place>('prompts');
  const name = names[place];
  const rows = report[place].filter(({ share }) => share.of > 0).map(({ key, share }): ShareRow => ({ key: String(key), name: name(key), note: `응답 ${times(share.calls)}`, kept: 1 - share.broken / share.of, amount: count(share.broken), rate: percent(share.broken, share.of) }));
  return (
    <Section title="깨진 곳" action={<Tabs label="나누는 기준" items={PLACES.map((value) => ({ value, label: PLACE_NAMES[value] }))} value={place} onChange={setPlace} />}>
      <ShareRows label={`${PLACE_NAMES[place]}별 ${CACHE_BROKEN}`} lost="broken" columns={[PLACE_NAMES[place], COULD, '깨짐', '비율']} rows={rows} />
    </Section>
  );
}

function useNames(): Names {
  const library = useLibrary();
  const characters = useCharacterName();
  const prompts = useCaptured((store) => (id: string | null) => (id === null ? UNKNOWN : (store.get('prompt', id)?.value.name ?? deletedOf(THINGS.prompt.noun))), []);
  return useMemo(() => {
    const titles = new Map([...library.characters, library.none].flatMap(({ chats }) => chats.map(({ id, title }) => [id, title] as const)));
    return { prompts, characters, chats: (id) => (id === null ? UNKNOWN : (titles.get(id) ?? deletedOf(THINGS.chat.noun))), live: (id) => titles.has(id) };
  }, [library, characters, prompts]);
}
