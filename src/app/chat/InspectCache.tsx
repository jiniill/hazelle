import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { refOf } from '../../connectors/assignment';
import type { From } from '../../engine/pipeline';
import type { ForecastPart } from '../../model/cache';
import type { Receipt } from '../../model/chat';
import { cacheShortfall } from '../../runtime/cache-diagnosis';
import type { LogEntry } from '../../runtime/request-log';
import type { Sending } from '../../runtime/turn-context';
import { cacheShare, cost, tokens } from '../common/receipt';
import { ago } from '../common/time';
import { CACHE_GUARD, MODEL_SETTINGS, opens, UNKNOWN } from '../common/words';
import { useLab } from '../common/labs';
import { useSession, useStore } from '../session';
import { navigate } from '../shell/router';
import { Button, Callout, Disclosure, Empty, Facts, List, ListItem, Row, Section, Stack, Text } from '../ui';
import { BrokenPartView, breakCauses, breakKind, diagnosed, Prescriptions, RecurrenceNote, ShortfallNote } from './CacheDiagnosis';
import { BROKEN, nextWarning, profileName, why } from './ChatCache';
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
  if (!cache.next) return cache.next === null ? <Empty variant="section">이전 응답에서 남은 캐시 기록이 없어요.</Empty> : <Text variant="note">계산하는 중…</Text>;
  return (
    <Stack gap="related">
      {lead}
      <NextCache next={cache.next} recurrence={cache.recurrence} editor={editor} onEdit={onEdit} />
    </Stack>
  );
}

// The log's entry, page memory only, adds the diagnosis to a stored receipt; subscribed so one landing late shows.
function PastReplies({ chat, replies }: { chat: string; replies: CacheNotes['replies'] }) {
  const { log } = useSession();
  useSyncExternalStore(log.subscribe, () => log.of(chat));
  const [open, setOpen] = useState<string | null>(null);
  if (!replies.length) return <Empty variant="section">받은 응답이 없어요.</Empty>;
  return (
    <List label="지난 응답">
      {replies.slice(0, RECENT).map(({ at, receipt }) => (
        <PastReply key={receipt.id} at={at} receipt={receipt} entry={log.entry(chat, receipt.id)} open={open === receipt.id} onToggle={() => setOpen(open === receipt.id ? null : receipt.id)} />
      ))}
    </List>
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
      description={broken ? [`${BROKEN}: ${why(broken, null)}`, breakCauses(entry?.diagnosis, broken)].filter(Boolean).join(' ') : undefined}
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

const STATES: Record<ForecastPart['state'], string> = { read: '캐시에서 읽음', write: '캐시에 새로 저장', tail: '캐시 안 함' };
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

type NextCacheProps = { next: NonNullable<CacheNotes['next']>; recurrence: CacheNotes['recurrence']; editor: (from: From) => Side | null; onEdit: (side: Side) => void };

export function NextCache({ next, recurrence, editor, onEdit }: NextCacheProps) {
  const { forecast, diagnosis, prescriptions, cost: price, route } = next;
  const store = useStore();
  const guard = useLab('cacheguard');
  const [open, setOpen] = useState<string | null>(null);
  const { against, written, tail, removed } = forecast;
  const warning = nextWarning(next, recurrence, profileName(store, route));
  const off = against?.broken?.kind === 'off' ? { label: opens(MODEL_SETTINGS), onClick: () => navigate({ kind: 'model', ...refOf(route.connection.id, route.model) }) } : undefined;
  return (
    <Stack gap="group">
      {warning && <Callout tone="warn" action={off}>{`${warning.words}: ${warning.why}`}</Callout>}
      <Facts
        variant="tiles"
        items={[
          { label: STATES.read, value: against ? tokens(against.read) : UNKNOWN, ...(!against && { tone: 'muted' as const }) },
          ...(forecast.prefix ? [] : [{ label: STATES.write, value: tokens(written) }]),
          { label: STATES.tail, value: tokens(tail) },
        ]}
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
      <Prescriptions prescriptions={prescriptions} cost={price} />
      {guard && against?.broken && diagnosis && prescriptions?.length === 0 && <Text variant="note">{`${CACHE_GUARD}로 해결할 수 있는 원인은 아니에요.`}</Text>}
      <List label="보낼 내용">
        {cacheRows(forecast.parts).map((row, index) => {
          const part = row.change && diagnosed(diagnosis, row.change, row.at);
          const side = row.change && editor(row.from);
          const key = `part:${row.at}`;
          return (
            <ListItem
              key={index}
              title={row.count > 1 ? `${row.name} ${row.count}개` : row.name}
              badge={row.change ? breakKind(row.change) : undefined}
              tags={[STATES[row.state], ...(row.point === 'cache' ? ['캐시 지점'] : row.point === 'short' ? ['캐시 지점 · 분량이 짧아 저장 안 됨'] : [])]}
              note={tokens(row.tokens)}
              {...(row.change && {
                expanded: open === key,
                onClick: () => setOpen(open === key ? null : key),
                detail: open === key && <BrokenDetail part={part} pending={diagnosis === undefined} edit={side ? { label: opens(row.name), onClick: () => onEdit(side) } : null} />,
              })}
            />
          );
        })}
      </List>
      {removed.length > 0 && (
        <Section level={3} title="이전보다 제외된 내용">
          <List label="이전보다 제외된 내용">
            {removed.map((part, index) => {
              const key = `removed:${part.before}`;
              return (
                <ListItem
                  key={index}
                  title={partName(part.from, part.role)}
                  note={tokens(part.tokens)}
                  expanded={open === key}
                  onClick={() => setOpen(open === key ? null : key)}
                  detail={open === key && <BrokenDetail part={diagnosed(diagnosis, 'removed', part.before)} pending={diagnosis === undefined} edit={null} />}
                />
              );
            })}
          </List>
        </Section>
      )}
    </Stack>
  );
}

// pending: the diagnosis is still worked out; once done, a part it has nothing on has lost the last call's text.
function BrokenDetail({ part, pending, edit }: { part: ReturnType<typeof diagnosed>; pending: boolean; edit: { label: string; onClick: () => void } | null }) {
  return (
    <Stack gap="related">
      {part ? <BrokenPartView part={part} /> : <Text variant="note">{pending ? '분석 중…' : '어떻게 바뀌었는지는 알 수 없어요.'}</Text>}
      {edit && (
        <Row kind="actions">
          <Button variant="secondary" size="sm" onClick={edit.onClick}>
            {edit.label}
          </Button>
        </Row>
      )}
    </Stack>
  );
}
