import { useEffect, useState } from 'react';
import { refOf } from '../../connectors/assignment';
import { tokenGroups, type From, type TokenSource } from '../../engine/pipeline';
import type { ForecastPart } from '../../model/cache';
import type { Rehearsal } from '../../runtime/script-preview';
import { afterEnter, previewRequest, type AfterEnter, type Sending } from '../../runtime/turn-context';
import { describeTurnFailure, runaway } from '../common/failure';
import { MESSAGE_ROLES, SLOT } from '../common/prompt-words';
import { cost, tokens } from '../common/receipt';
import { MODEL_SETTINGS, opens, PRE_READ, UNKNOWN } from '../common/words';
import { useSession, useStore } from '../session';
import { navigate } from '../shell/router';
import { Button, Callout, CodeBlock, Disclosure, Empty, Facts, Gauge, List, ListItem, Row, Section, Stack, Text } from '../ui';
import { BrokenPartView, breakKind, diagnosed, Prescriptions, RecurrenceNote } from './CacheDiagnosis';
import { nextWarning, profileName } from './ChatCache';
import { partName, RequestView } from './ChatSent';
import { HookList, STAGES } from './InspectScripts';
import type { Side } from './panels';
import type { CacheNotes, SendNotes } from './useSendNotes';

function later(steps: AfterEnter[]): string[] {
  return steps.map((step) => {
    switch (step.kind) {
      case 'input-translation':
        return '입력 번역';
      case 'tools':
        return '플러그인의 새 답';
      case 'retrieval':
        return '기억 검색';
      case 'preread':
        return PRE_READ;
    }
  });
}

export function NextRequest({ chat, sending, request, cache, editor, onEdit }: { chat: string; sending: Sending; request: SendNotes['request']; cache: CacheNotes; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const session = useSession();
  const missing = later(afterEnter(session, chat, sending.turn));
  return (
    <Stack gap="section">
      <Section title="보낼 입력">
        <NextTokens sending={sending} />
      </Section>
      <Section title="캐시" help="토큰 수는 추정치예요.">
        {cache.next ? <NextCache next={cache.next} recurrence={cache.recurrence} editor={editor} onEdit={onEdit} /> : cache.next === null ? <Empty variant="section">직전 요청이 남긴 캐시 기록이 없어요.</Empty> : <Text variant="note">계산하는 중…</Text>}
      </Section>
      <RequestView
        level={2}
        prompt={sending.prompt}
        title="보낼 순서대로"
        lead={missing.length > 0 && <Text variant="note">{`보낼 때 실행돼서 여기에는 없어요: ${missing.join(', ')}`}</Text>}
        request={request}
        unbuilt={UNBUILT}
        editor={editor}
        onEdit={onEdit}
      />
      <Rehearsed chat={chat} sending={sending} editor={editor} onEdit={onEdit} />
    </Stack>
  );
}

const UNBUILT = '이 연결 방식은 요청 본문을 미리 만들어 볼 수 없어요.';

// Mounted only while the 요청 tab shows and no reply is being written (ChatInspect), so a send never waits on one.
function Rehearsed({ chat, sending, editor, onEdit }: { chat: string; sending: Sending; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const { scriptPreview } = useSession();
  const [rehearsal, setRehearsal] = useState<Rehearsal | null | 'failed' | undefined>(undefined);
  useEffect(() => {
    setRehearsal(undefined);
    const controller = new AbortController();
    scriptPreview.rehearse(chat, sending, controller.signal).then(
      (result) => !controller.signal.aborted && setRehearsal(result),
      () => !controller.signal.aborted && setRehearsal('failed'),
    );
    return () => controller.abort();
  }, [chat, sending]);
  if (rehearsal === null) return null;
  return (
    <Section title="스크립트 실행 예상" help="보내기 전에 실행되는 봇 스크립트를 미리 실행해 본 결과예요.">
      {rehearsal === undefined ? (
        <Text variant="note">계산하는 중…</Text>
      ) : rehearsal === 'failed' ? (
        <Empty variant="section">스크립트를 미리 실행하지 못했어요.</Empty>
      ) : (
        <RehearsalView rehearsal={rehearsal} sending={sending} editor={editor} onEdit={onEdit} />
      )}
    </Section>
  );
}

function RehearsalView({ rehearsal, sending, editor, onEdit }: { rehearsal: Rehearsal; sending: Sending; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const { trace, stopped, said, asked, calls, input, prompt, request, changed, loreRanAway } = rehearsal;
  const facts = [
    ...(input === null ? [] : [{ label: '입력이 바뀌어요', value: input }]),
    ...(asked.length ? [{ label: '보낼 때 물어봐요', value: `${asked.length}개` }] : []),
    ...(said.length ? [{ label: '보낼 때 알림을 띄워요', value: `${said.length}개` }] : []),
    ...(calls.model ? [{ label: '보낼 때 모델을 호출해요', value: `${calls.model}번` }] : []),
    ...(calls.embed ? [{ label: '보낼 때 임베딩을 만들어요', value: `${calls.embed}번` }] : []),
    ...(calls.background ? [{ label: '보낼 때 배경을 바꿔요', value: `${calls.background}번` }] : []),
  ];
  return (
    <Stack gap="related">
      {facts.length > 0 && <Facts items={facts} variant="tiles" />}
      {loreRanAway && <Callout tone="warn">{runaway('로어북을 스크립트에 넘기기 전에')}</Callout>}
      {stopped !== null ? (
        <Text variant="note">{`${STAGES[stopped]} 단계에서 멈춰서 요청을 보내지 않아요.`}</Text>
      ) : !changed ? (
        <Text variant="note">스크립트가 요청을 바꾸지 않아요.</Text>
      ) : null}
      {trace.entries.length > 0 && <HookList label="스크립트 실행 예상" entries={trace.entries.map((entry, index) => ({ entry, key: String(index) }))} note={(entry) => `${Math.round(entry.duration)}ms`} />}
      {trace.omitted > 0 && <Text variant="note">{`앞선 기록 ${trace.omitted}개는 빠졌어요.`}</Text>}
      {prompt !== null && ('kind' in prompt ? <Callout tone="warn">{describeTurnFailure(prompt)}</Callout> : <RequestView prompt={prompt} title="스크립트 실행 후" request={() => previewRequest({ ...sending, prompt })} unbuilt={UNBUILT} editor={editor} onEdit={onEdit} sameAs={sending.prompt.problems} />)}
      {request !== null && (
        <Section level={3} title="요청 편집 후">
          <Stack gap="related">
            {request.map((message, index) => (
              <Disclosure key={index} label={MESSAGE_ROLES[message.role]}>
                <CodeBlock>{message.content}</CodeBlock>
              </Disclosure>
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

function sourceName(source: TokenSource): string {
  switch (source.kind) {
    case 'description':
    case 'persona':
    case 'memory':
    case 'lorebook':
      return SLOT[source.kind].name;
    case 'chat':
      return '대화';
    default:
      return partName(source, 'system');
  }
}

function NextTokens({ sending }: { sending: Sending }) {
  const { groups, total, fit, dropped } = tokenGroups(sending.prompt, sending.calibration);
  const counted = (source: TokenSource, count: number) => (source.kind === 'chat' ? `메시지 ${count}개` : source.kind === 'lorebook' ? `항목 ${count}개` : undefined);
  return (
    <Stack gap="related">
      <Gauge
        share={fit.allowance ? total / fit.allowance : undefined}
        tone={fit.allowance && total > fit.allowance ? 'warn' : 'plain'}
        amount={`약 ${tokens(total)}`}
        of={fit.allowance === null ? undefined : `약 ${tokens(fit.allowance)}`}
        note={['앱 추정', ...(fit.allowance !== null && fit.multiplier !== null ? [`배율 ×${fit.multiplier.toFixed(2)} 반영`] : [])].join(' · ')}
      />
      {fit.allowance === null && <Text variant="note">모델 한도를 알 수 없어서 내용을 줄이지 않아요.</Text>}
      {dropped > 0 && <Text variant="note">{`한도를 넘어서 오래된 메시지 ${dropped}개가 빠져요.`}</Text>}
      <Disclosure label="토큰을 쓰는 곳">
        <List label="토큰을 쓰는 곳">
          {[...groups].sort((a, b) => b.tokens - a.tokens).map((group) => (
            <ListItem key={JSON.stringify(group.source)} title={sourceName(group.source)} description={counted(group.source, group.count)} note={tokens(group.tokens)} />
          ))}
        </List>
      </Disclosure>
    </Stack>
  );
}

const STATES: Record<ForecastPart['state'], string> = { read: '캐시에서 읽음', write: '새로 저장', tail: '캐시 밖' };
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

function NextCache({ next, recurrence, editor, onEdit }: NextCacheProps) {
  const { forecast, diagnosis, prescriptions, cost: price, route } = next;
  const store = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const { against, written, tail, removed } = forecast;
  const warning = nextWarning(next, recurrence, profileName(store, route));
  const off = against?.broken?.kind === 'off' ? { label: opens(MODEL_SETTINGS), onClick: () => navigate({ kind: 'model', ...refOf(route.connection.id, route.model) }) } : undefined;
  return (
    <Stack gap="group">
      <RecurrenceNote recurrence={recurrence} />
      {warning && <Callout tone="warn" action={off}>{`${warning.words}: ${warning.why}`}</Callout>}
      <Facts
        variant="tiles"
        items={[
          { label: STATES.read, value: against ? tokens(against.read) : UNKNOWN, ...(!against && { tone: 'muted' as const }) },
          ...(forecast.prefix ? [] : [{ label: STATES.write, value: tokens(written) }]),
          { label: STATES.tail, value: tokens(tail) },
        ]}
      />
      {!against && <Text variant="note">직전 요청 기록이 없어서 얼마나 읽을지 알 수 없어요.</Text>}
      {price && (
        <Facts
          items={[
            { label: '이대로 보내면', value: cost(price.paid) },
            { label: '캐시를 다 읽으면', value: cost(price.whole) },
          ]}
        />
      )}
      <Prescriptions prescriptions={prescriptions} cost={price} />
      <List label="보낼 메시지">
        {cacheRows(forecast.parts).map((row, index) => {
          const part = row.change && diagnosed(diagnosis, row.change, row.at);
          const side = row.change && editor(row.from);
          const key = `part:${row.at}`;
          return (
            <ListItem
              key={index}
              title={row.count > 1 ? `${row.name} ${row.count}개` : row.name}
              badge={row.change ? breakKind(row.change) : undefined}
              tags={[STATES[row.state], ...(row.point === 'cache' ? ['캐시 지점'] : row.point === 'short' ? ['캐시 지점 · 최소 크기 미만'] : [])]}
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
        <Section level={3} title="빠지는 메시지">
          <List label="빠지는 메시지">
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
      {part ? <BrokenPartView part={part} /> : <Text variant="note">{pending ? '살펴보는 중…' : '어떻게 바뀌었는지는 알 수 없어요.'}</Text>}
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
