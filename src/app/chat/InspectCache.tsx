import { ArrowRightLeft, ListPlus, PenLine, Scissors } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { refOf } from '../../connectors/assignment';
import type { From } from '../../engine/pipeline';
import type { CacheBreak, CacheDiagnosis, ForecastPart } from '../../model/cache';
import type { Receipt } from '../../model/chat';
import { cacheShortfall } from '../../runtime/diagnostics/cache-diagnosis';
import type { LogEntry } from '../../runtime/models/request-log';
import type { Sending } from '../../runtime/chat/turn-context';
import { cacheShare, cost, tokens } from '../common/receipt';
import { CacheNoteRow } from '../common/CacheNoteRow';
import { ago } from '../common/time';
import { useShown } from '../common/useLoaded';
import { CACHE_GUARD, COUNTING, MODEL_SETTINGS, opens, UNKNOWN, CACHE_BROKEN, CACHE_READ } from '../common/words';
import { useLab } from '../common/labs';
import { useCaptured, useSession } from '../session';
import { navigate } from '../shell/router';
import { Button, Callout, Disclosure, Empty, Facts, List, ListItem, Row, RunMarks, Section, SendLine, SendRuns, SettingGroup, Stack, Tag, Text, type SendFate, type SendRun } from '../ui';
import { BrokenPartView, breakCauses, breakKind, causeFacts, leakWords, PartDiff, PrescriptionView, RecurrenceNote, ShortfallNote } from './CacheDiagnosis';
import { nextWarning, profileName, why } from './ChatCache';
import { partName } from './ChatSent';
import { useSendTimeNote } from './InspectRequest';
import type { Side } from './panels';
import type { CacheNotes } from './useSendNotes';

const RECENT = 10;

// 캐시: the next send's forecast, then what the latest replies read. next is the forecast's place, already judged by
// whether a send can be built now (ChatInspect).
export function Cache({ chat, next, cache }: { chat: string; next: ReactNode; cache: CacheNotes }) {
  return (
    <Stack gap="section">
      <SettingGroup label="캐시 표시">
        <CacheNoteRow />
      </SettingGroup>
      <Section title="다음 전송" help="토큰 수는 추정치예요.">
        {next}
      </Section>
      <Section title="지난 응답" help="마지막으로 새로고침한 뒤에 받은 응답만 어디가 어떻게 바뀌었는지 비교해 볼 수 있어요.">
        <Stack gap="related">
          <RecurrenceNote recurrence={cache.recurrence} />
          <PastReplies chat={chat} replies={cache.replies} />
        </Stack>
      </Section>
    </Stack>
  );
}

export function NextCacheView({ chat, sending, cache, editor, onEdit }: { chat: string; sending: Sending; cache: CacheNotes; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const lead = useSendTimeNote(chat, sending);
  if (!cache.next) return cache.next === null ? <Empty variant="section">이전 응답에서 남은 캐시 기록이 없어요.</Empty> : <Text variant="note">{COUNTING}</Text>;
  return (
    <Stack gap="related">
      {lead}
      <NextCache next={cache.next} recurrence={cache.recurrence} replies={cache.replies} editor={editor} onEdit={onEdit} />
    </Stack>
  );
}

// The log's entry, this device's only, adds the diagnosis to a stored receipt; subscribed so one landing late shows.
function PastReplies({ chat, replies }: { chat: string; replies: CacheNotes['replies'] }) {
  const { log } = useSession();
  useSyncExternalStore(log.subscribe, () => log.of(chat));
  const [open, setOpen] = useState<string | null>(null);
  const shown = useShown(replies, RECENT);
  if (!replies.length) return <Empty variant="section">받은 응답이 없어요.</Empty>;
  return (
    <>
      <List label="지난 응답">
        {shown.rows.map(({ at, receipt }) => (
          <PastReply key={receipt.id} at={at} receipt={receipt} entry={log.entry(chat, receipt.id)} open={open === receipt.id} onToggle={() => setOpen(open === receipt.id ? null : receipt.id)} />
        ))}
      </List>
      {shown.more}
    </>
  );
}

function PastReply({ at, receipt, entry, open, onToggle }: { at: number; receipt: Receipt; entry: LogEntry | null; open: boolean; onToggle: () => void }) {
  const share = cacheShare(receipt.usage);
  const broken = receipt.forecast?.broken;
  const parts = entry?.diagnosis?.parts ?? [];
  const short = !!cacheShortfall(receipt)?.short;
  return (
    <ListItem
      title={receipt.modelName}
      badge={share === null ? undefined : `${share}% 읽음`}
      description={broken ? [`${CACHE_BROKEN}: ${why(broken, null)}`, breakCauses(entry?.diagnosis, broken)].filter(Boolean).join(' ') : undefined}
      tags={share === null ? [`읽은 양 ${UNKNOWN}`] : undefined}
      note={ago(at)}
      {...(parts.length > 0 && { expanded: open, onClick: onToggle })}
      detail={
        (short || open) && (
          <Stack gap="related">
            <ShortfallNote receipt={receipt} entry={entry} />
            {open && parts.map((part, index) => (
              <Disclosure key={index} label={`${partName(part.from, part.role)} · ${breakKind(part.kind)}`}>
                <BrokenPartView part={part} />
              </Disclosure>
            ))}
          </Stack>
        )
      }
    />
  );
}

const STATES: Record<ForecastPart['state'], string> = { read: CACHE_READ, write: '캐시에 새로 저장', tail: '캐시 안 함' };
type CacheRow = { name: string; tokens: number; count: number; at: number } & Pick<ForecastPart, 'from' | 'state' | 'change' | 'point'>;

// Neighbours of one part, alike in how the cache takes them, read as one row; a point ends its row. A changed part is
// a row of its own, so its from is the row's.
function cacheRows(parts: ForecastPart[]): CacheRow[] {
  const out: CacheRow[] = [];
  for (const [at, part] of parts.entries()) {
    const name = partName(part.from, part.role);
    const open = out.at(-1);
    if (open && !open.point && !open.change && !part.change && open.name === name && open.state === part.state) {
      open.tokens += part.tokens;
      open.count++;
      open.point = part.point;
    } else out.push({ name, tokens: part.tokens, count: 1, at, from: part.from, state: part.state, change: part.change, point: part.point });
  }
  return out;
}

const FATES: Record<SendFate, string> = { read: '읽음', again: '다시 보냄', fresh: '새로 보냄' };
const fateOf = ({ state, again }: ForecastPart): SendFate => (state === 'read' ? 'read' : again ? 'again' : 'fresh');
const sum = (parts: { tokens: number }[]) => parts.reduce((total, { tokens }) => total + tokens, 0);
const isChat = ({ from }: { from: From }) => from.kind === 'block' && from.slot === 'chat';

// The request as SendLine draws it: its parts by fate, the last call cut where this one stops reading it, the first
// part that moved, and what stands before, in and after the chat.
function sendLine({ forecast, was }: NonNullable<CacheNotes['next']>) {
  const { parts, against } = forecast;
  const total = sum(parts);
  const first = parts.findIndex(isChat);
  const last = parts.findLastIndex(isChat);
  const moved = parts.findIndex((part) => part.change === 'moved' && part.before !== null);
  return {
    share: against && total ? Math.round((against.read / total) * 100) : null,
    segments: parts.map((part) => ({ size: part.tokens, fate: fateOf(part) })),
    cut: against ? { at: against.read, note: against.read ? `${tokens(against.read)} 토큰까지 읽음` : '처음부터 다시 보냄' } : undefined,
    was: was && against ? {
      label: '지난 전송',
      segments: [{ size: against.read, fate: 'read' as const }, { size: against.of - against.read, fate: 'again' as const }, { size: sum(was) - against.of, fate: 'fresh' as const }],
      ...(moved !== -1 && { moved: { from: sum(was.slice(0, parts[moved]!.before!)), to: sum(parts.slice(0, moved)), size: parts[moved]!.tokens } }),
    } : undefined,
    spans: first === -1 ? [] : [{ label: '대화 앞', size: sum(parts.slice(0, first)) }, { label: '대화', size: sum(parts.slice(first, last + 1)) }, { label: '대화 뒤', size: sum(parts.slice(last + 1)) }].filter(({ size }) => size > 0),
    legend: (['read', 'again', 'fresh'] as const).map((fate) => ({ fate, label: FATES[fate], value: tokens(sum(parts.filter((part) => fateOf(part) === fate))) })).filter(({ fate, value }) => fate !== 'again' || value !== tokens(0)),
  };
}

const sameBreak = (broken: CacheBreak | null | undefined, part: Pick<CacheDiagnosis['parts'][number], 'kind' | 'from' | 'role'>) => !!broken && 'from' in broken && broken.kind === part.kind && broken.role === part.role && JSON.stringify(broken.from) === JSON.stringify(part.from);

// The latest replies as SendRuns draws them, oldest first.
function sendRuns(replies: CacheNotes['replies']) {
  const recent = replies.slice(0, RECENT).reverse();
  const runs = recent.map(({ receipt }): SendRun => {
    const share = cacheShare(receipt.usage);
    return { share: (share ?? 0) / 100, state: receipt.forecast?.broken ? 'broken' : cacheShortfall(receipt)?.short ? 'missed' : share === null ? 'unread' : 'kept' };
  });
  const count = (state: SendRun['state']) => `${runs.filter((run) => run.state === state).length}번`;
  return { recent, runs, legend: [{ state: 'broken' as const, label: CACHE_BROKEN, value: count('broken') }, { state: 'missed' as const, label: '제공자가 놓침', value: count('missed') }] };
}

const LEAK_ICONS = { changed: PenLine, added: ListPlus, removed: Scissors, moved: ArrowRightLeft } as const;

type NextCacheProps = { next: NonNullable<CacheNotes['next']>; recurrence: CacheNotes['recurrence']; replies: CacheNotes['replies']; editor: (from: From) => Side | null; onEdit: (side: Side) => void };

function NextCache({ next, recurrence, replies, editor, onEdit }: NextCacheProps) {
  const { forecast, diagnosis, prescriptions, cost: price, route } = next;
  const profile = useCaptured((store) => profileName(store, route), [route]);
  const guard = useLab('cacheguard');
  const [open, setOpen] = useState<string | null>(null);
  const { against, removed } = forecast;
  const warning = nextWarning(next, recurrence, profile);
  const whole = warning && !(against?.broken && 'from' in against.broken);
  const off = against?.broken?.kind === 'off' ? { label: opens(MODEL_SETTINGS), onClick: () => navigate({ kind: 'model', ...refOf(route.connection.id, route.model) }) } : undefined;
  const line = sendLine(next);
  const { recent, runs, legend } = sendRuns(replies);
  const leaks = diagnosis?.parts ?? [];
  return (
    <Stack gap="group">
      {whole && <Callout tone="warn" action={off}>{`${warning.words}: ${warning.why}`}</Callout>}
      <SendLine
        label={`다음 전송 ${tokens(sum(forecast.parts))} 토큰 중 ${against ? tokens(against.read) : UNKNOWN} 토큰을 캐시에서 읽음`}
        figure={line.share === null ? '–' : String(line.share)}
        unit="%"
        caption={CACHE_READ}
        tone={against?.broken ? 'warn' : 'plain'}
        segments={line.segments}
        was={line.was}
        now="다음 전송"
        cut={line.cut}
        spans={line.spans}
        legend={line.legend}
      />
      {!against && <Text variant="note">이전 응답 기록이 없어서 캐시에서 얼마나 읽을지 알 수 없어요.</Text>}
      {price && (
        <Facts
          items={[
            { label: '현재 예상 비용', value: cost(price.paid) },
            { label: '캐시 전체 적중 시', value: cost(price.whole) },
          ]}
        />
      )}
      {runs.length > 1 && (
        <Section level={3} title={`최근 ${runs.length}번`}>
          <SendRuns label={`최근 응답 ${runs.length}번이 캐시에서 읽은 비율`} runs={runs} ends={[`${runs.length}번 전`, '방금']} legend={legend} />
        </Section>
      )}
      {against?.broken && 'from' in against.broken && (
        <Section level={3} title={`새는 곳 ${leaks.length || ''}`.trim()} help="캐시에서 읽지 못하고 다시 보내는 부분과 그 원인이에요. 토큰 수는 그 부분부터 다시 보내는 양이에요.">
          {diagnosis === undefined && <Text variant="note">분석 중…</Text>}
          {prescriptions === null && <Text variant="note">해결 방법을 계산하지 못했어요.</Text>}
          <List label="새는 곳" box>
            {leaks.map((part, index) => {
              const key = `leak:${index}`;
              const at = part.after ?? 0;
              const side = editor(part.from);
              const name = partName(part.from, part.role);
              const fixes = prescriptions?.filter(({ from, role }) => role === part.role && JSON.stringify(from) === JSON.stringify(part.from)) ?? [];
              const hits = recent.map(({ receipt }) => sameBreak(receipt.forecast?.broken, part));
              return (
                <ListItem
                  key={index}
                  leading={<Tag icon={LEAK_ICONS[part.kind]} />}
                  title={name}
                  tags={leakWords(part)}
                  note={`${tokens(sum(forecast.parts.slice(at).filter(({ again }) => again)))} 토큰`}
                  expanded={open === key}
                  onClick={() => setOpen(open === key ? null : key)}
                  detail={
                    open === key && (
                      <Stack gap="group">
                        {hits.some(Boolean) && <RunMarks on={hits} note={`최근 ${hits.length}번 중 ${hits.filter(Boolean).length}번`} />}
                        {part.causes.some((each) => causeFacts(each).length > 0) && <Facts items={part.causes.flatMap(causeFacts)} />}
                        {fixes.map((prescription, fix) => (
                          <PrescriptionView key={fix} prescription={prescription} cost={price} />
                        ))}
                        {guard && prescriptions?.length === 0 && <Text variant="note">{`${CACHE_GUARD}로 해결할 수 있는 원인은 아니에요.`}</Text>}
                        <PartDiff part={part} />
                        {side && (
                          <Row kind="actions">
                            <Button variant="secondary" size="sm" onClick={() => onEdit(side)}>
                              {opens(name)}
                            </Button>
                          </Row>
                        )}
                      </Stack>
                    )
                  }
                />
              );
            })}
          </List>
        </Section>
      )}
      <Disclosure label="보낼 내용 전체">
        <Stack gap="group">
          <List label="보낼 내용">
            {cacheRows(forecast.parts).map((row, index) => (
              <ListItem
                key={index}
                title={row.count > 1 ? `${row.name} ${row.count}개` : row.name}
                badge={row.change ? breakKind(row.change) : undefined}
                tags={[STATES[row.state], ...(row.point === 'cache' ? ['캐시 지점'] : row.point === 'short' ? ['캐시 지점 · 분량이 짧아 저장 안 됨'] : [])]}
                note={tokens(row.tokens)}
              />
            ))}
          </List>
          {removed.length > 0 && (
            <Section level={3} title="이전보다 제외된 내용">
              <List label="이전보다 제외된 내용">
                {removed.map((part, index) => (
                  <ListItem key={index} title={partName(part.from, part.role)} note={tokens(part.tokens)} />
                ))}
              </List>
            </Section>
          )}
        </Stack>
      </Disclosure>
    </Stack>
  );
}
