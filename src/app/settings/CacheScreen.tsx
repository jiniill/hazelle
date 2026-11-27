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
const PLACE_NAMES: Record<Place, string> = { prompts: PAGES.prompts, characters: '캐릭터', chats: '채팅' };
const ICONS: Record<CacheBreak['kind'], LucideIcon> = { model: Settings2, account: Settings2, reasoning: Settings2, off: Settings2, expired: Clock, far: ListPlus, changed: PenLine, added: ListPlus, removed: Scissors, moved: ArrowRightLeft };

const percent = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
const times = (value: number) => `${count(value)}번`;
const amount = (value: number) => `${count(value)} 토큰`;
const leakName = (cause: CacheBreak) => ('from' in cause ? partName(cause.from, cause.role) : breakWord(cause));

export function CacheScreen({ back }: { back: Back | null }) {
  const [window, setWindow] = useState<ReportWindow>('month');
  const { view, retry, noted, unfilled, caching, fill } = useCacheLedger();
  const [now] = useState(Date.now);
  const report = useMemo(() => noted && cacheReport(noted, window === 'all' ? 0 : windowStart(window, now), ({ call, forecast }) => cacheMissed({ ...call, forecast })), [noted, window, now]);
  return (
    <Screen width="form" top={<NavBar title={CACHE_PAGE} {...backBar(back)} />}>
      <Tabs label="기간" items={WINDOWS.map((value) => ({ value, label: SPANS[value] }))} value={window} onChange={setWindow} />
      {view.kind !== 'read' ? (
        <LedgerWait view={view} retry={retry} failed={`${CACHE_PAGE} 기록을 불러오지 못했어요.`} />
      ) : (
        <>
          {caching ? <CacheWait /> : unfilled > 0 && <NoticeBar icon={History} title="지난 기록" note={`채팅 ${count(unfilled)}개를 아직 읽지 않았어요`} hint={{ label: '지난 기록', text: '이 화면이 생기기 전의 응답은 채팅마다 읽어 와야 해요. 채팅이 많으면 시간이 걸려요.' }} actions={<Button variant="secondary" size="sm" onClick={fill}>지난 기록 읽기</Button>} />}
          {report!.total.calls === 0 ? <Empty>이 기간에는 캐시 기록이 없어요.</Empty> : <Report report={report!} />}
        </>
      )}
    </Screen>
  );
}

function Report({ report }: { report: CacheReport }) {
  const { total, leaks, providers, causes } = report;
  const read = cacheRead(total);
  const frequent = leaks.reduce((most, leak) => (leak.times > most.times ? leak : most), leaks[0]!);
  const missing = providers.filter(({ share }) => share.missed > 0);
  return (
    <Stack gap="section">
      <SendLine
        label={`캐시로 읽을 수 있었던 ${amount(total.of)} 중 ${amount(read)}을 ${CACHE_READ}`}
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
      {leaks.length > 0 && <Leaks leaks={leaks} lost={total.broken} />}
      {missing.length > 0 && (
        <Section title={PROVIDER_MISSED} note={amount(total.missed)} help="요청은 캐시를 읽을 수 있었는데 제공자가 읽지 않은 양이에요. 프롬프트나 설정으로 고칠 수 있는 곳은 아니에요.">
          <ShareRows
            label={`모델별 ${PROVIDER_MISSED}`}
            lost="missed"
            columns={['모델', '읽을 수 있었던 양', '놓침', '비율']}
            rows={missing.map(({ connection, model, modelName, source, share }) => {
              const could = share.of - share.broken;
              return { key: `${connection}:${model}`, name: modelName, note: source, kept: 1 - share.missed / could, amount: count(share.missed), rate: percent(share.missed, could) };
            })}
          />
        </Section>
      )}
      <Places report={report} />
      {causes.length > 0 && (
        <Section title="세부 원인" help="응답마다 진단이 짚은 원인이에요. 이 화면이 생긴 뒤의 응답부터 쌓여요.">
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

function Leaks({ leaks, lost }: { leaks: CacheReport['leaks']; lost: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const chatName = useChatName();
  return (
    <Section title={CACHE_BROKEN} note={amount(lost)} help="내 프롬프트, 로어북, 메시지 수정처럼 요청이 달라져서 캐시를 읽지 못한 곳이에요. 토큰 수는 그 때문에 다시 보낸 양이에요.">
      <List label={CACHE_BROKEN} box>
        {leaks.map(({ cause, lost: gone, times: happened, chats }, at) => (
          <ListItem
            key={at}
            leading={<Tag icon={ICONS[cause.kind]} />}
            title={leakName(cause)}
            tags={['from' in cause ? [breakWord(cause)] : [], [times(happened), `한 번에 ${count(Math.round(gone / happened))}`]].flat()}
            note={amount(gone)}
            expanded={open === at}
            onClick={() => setOpen(open === at ? null : at)}
            detail={
              open === at && (
                <LeakChats chats={chats} chatName={chatName} />
              )
            }
          />
        ))}
      </List>
    </Section>
  );
}

const CHATS = 5;

function LeakChats({ chats, chatName }: { chats: CacheReport['leaks'][number]['chats']; chatName: ReturnType<typeof useChatName> }) {
  const shown = useShown(chats, CHATS);
  return (
    <>
      <List label="일어난 채팅">
        {shown.rows.map(({ key, lost, times: happened }) => (
          <ListItem key={key} title={chatName(key)} tags={[times(happened)]} note={amount(lost)} {...(key !== null && chatName.live(key) && { onClick: () => navigate({ kind: 'chat', id: key }) })} />
        ))}
      </List>
      {shown.more}
    </>
  );
}

function Places({ report }: { report: CacheReport }) {
  const [place, setPlace] = useState<Place>('prompts');
  const characterName = useCharacterName();
  const chatName = useChatName();
  const promptName = useCaptured((store) => (id: string | null) => (id === null ? UNKNOWN : (store.get('prompt', id)?.value.name ?? deletedOf(THINGS.prompt.noun))), []);
  const name = { prompts: promptName, characters: characterName, chats: chatName }[place];
  const rows = report[place].filter(({ share }) => share.of > 0).map(({ key, share }): ShareRow => ({ key: String(key), name: name(key), note: `응답 ${times(share.calls)}`, kept: 1 - share.broken / share.of, amount: count(share.broken), rate: percent(share.broken, share.of) }));
  return (
    <Section title="어디에서" action={<Tabs label="나누는 기준" items={PLACES.map((value) => ({ value, label: PLACE_NAMES[value] }))} value={place} onChange={setPlace} />}>
      <ShareRows label={`${PLACE_NAMES[place]}별 ${CACHE_BROKEN}`} lost="broken" columns={[PLACE_NAMES[place], '읽을 수 있었던 양', '깨짐', '비율']} rows={rows} />
    </Section>
  );
}

function useChatName() {
  const library = useLibrary();
  return useMemo(() => {
    const titles = new Map([...library.characters, library.none].flatMap(({ chats }) => chats.map(({ id, title }) => [id, title] as const)));
    return Object.assign((id: string | null) => (id === null ? UNKNOWN : (titles.get(id) ?? deletedOf(THINGS.chat.noun))), { live: (id: string) => titles.has(id) });
  }, [library]);
}
