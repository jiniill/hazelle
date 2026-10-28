import type { Cost } from '../../connectors/types';
import { cacheDiff } from '../../engine/cache-diff';
import type { CacheBreak, CacheBreakCost, CacheCause, CacheDiagnosis, CachePrescription, CacheRecurrence } from '../../model/cache';
import type { Receipt } from '../../model/chat';
import { cacheShortfall, shortfallPlace } from '../../runtime/cache-diagnosis';
import { applyCacheEdit } from '../../runtime/cache-prescriptions';
import type { LogEntry } from '../../runtime/request-log';
import { cost, tokens } from '../common/receipt';
import { loreName } from '../common/words';
import { useStore } from '../session';
import { useToast } from '../toast';
import { useState, type ReactNode } from 'react';
import { Button, Hint, List, ListItem, Row, Section, Stack, Tag, Text, TextDiff } from '../ui';
import { partName } from './ChatSent';
import { silentReason } from './InspectModules';

type BrokenPart = CacheDiagnosis['parts'][number];

const KINDS = { changed: '변경됨', added: '추가됨', removed: '제외됨', moved: '위치 바뀜' } as const;
export const breakKind = (kind: keyof typeof KINDS) => KINDS[kind];

const quoted = (value: string) => (value === '' ? '(빈 값)' : `'${value.length > 60 ? `${value.slice(0, 60)}…` : value}'`);

const VARYING = '매번 바뀌는 내용을 대화 뒤로 옮기면 앞부분 캐시가 깨지지 않아요.';

// One sentence per cause, and behind its ⓘ what would keep it from breaking. shown: the sentence as the part's detail
// draws it, where it differs from the line the send note reads.
function cause(cause: CacheCause): { line: string; shown?: ReactNode; help: string | null } {
  switch (cause.kind) {
    case 'tag':
      return {
        line: `${cause.tag} 값이 바뀌었어요: ${quoted(cause.before)} → ${quoted(cause.after)}.`,
        shown: (
          <>
            {`${cause.tag} 값이 바뀌었어요 `}<TextDiff inline label="전" runs={[{ kind: 'before', text: cause.before || '(빈 값)' }]} /> → <TextDiff inline label="후" runs={[{ kind: 'after', text: cause.after || '(빈 값)' }]} />
          </>
        ),
        help: VARYING,
      };
    case 'lore': {
      const fired = cause.after?.fired ?? false;
      const quiet = !fired && cause.after && !cause.after.fired ? ` (${silentReason(cause.after.why)})` : '';
      return {
        line: fired ? `로어북 '${cause.name}' 항목이 새로 켜졌어요.` : `로어북 '${cause.name}' 항목이 꺼졌어요${quiet}.`,
        help: '자주 켜졌다 꺼지는 항목은 항상 켜 두거나 대화 맨 뒤(깊이 0)에 넣으면 앞부분 캐시가 유지돼요.',
      };
    }
    case 'moved':
      return cause.depth === null
        ? { line: '내용은 같지만 들어가는 위치가 바뀌었어요.', help: null }
        : { line: `깊이 ${cause.depth}에 넣는 항목이라 대화가 길어지면서 들어가는 위치가 밀렸어요.`, help: '깊이 숫자를 작게 할수록 대화 뒤쪽에 들어가서 앞부분 캐시가 더 많이 유지돼요.' };
    case 'edited':
      return { line: '대화 메시지가 수정됐어요.', help: null };
    case 'memory':
      return { line: '장기 기억이 새로 정리됐어요.', help: '장기 기억이 새로 정리될 때마다 그 뒤에 오는 내용의 캐시가 한 번 깨져요.' };
    case 'unknown':
      return { line: '정확한 원인을 찾지 못했어요.', help: '스크립트나 토큰 절약이 보낼 내용을 바꿨거나, 여러 항목이 합쳐진 부분일 수 있어요.' };
  }
}

// Show all causes of the first broken part: changes can compound (e.g. a lore entry fired and moved).
// Whole-call breaks have no part cause, even if diagnosis lists unrelated changes.
export function breakCauses(diagnosis: CacheDiagnosis | null | undefined, broken: CacheBreak): string | null {
  if (!('from' in broken)) return null;
  const part = diagnosis?.parts.find(({ kind, from, role }) => kind === broken.kind && role === broken.role && JSON.stringify(from) === JSON.stringify(broken.from));
  const named = part?.causes.filter(({ kind }) => kind !== 'unknown') ?? [];
  return named.length ? named.map((each) => cause(each).line).join(' ') : null;
}

export const diagnosed = (diagnosis: CacheDiagnosis | null | undefined, kind: BrokenPart['kind'], at: number) =>
  diagnosis?.parts.find((part) => part.kind === kind && (kind === 'removed' ? part.before : part.after) === at) ?? null;

export function BrokenPartView({ part }: { part: BrokenPart }) {
  const { diff } = part;
  const differs = diff?.runs.some(({ kind }) => kind !== 'same');
  return (
    <Stack gap="related">
      {part.causes.map((each, index) => {
        const { line, shown, help } = cause(each);
        return (
          <Text key={index}>
            {shown ?? line}
            {help && <Hint label="깨지지 않게 하려면">{help}</Hint>}
          </Text>
        );
      })}
      {diff === null ? (
        <Text variant="note">이전 요청 원문이 남지 않아서 어떻게 바뀌었는지는 알 수 없어요.</Text>
      ) : (
        differs && (
          <>
            <Text variant="note">변경된 부분</Text>
            <TextDiff runs={diff.runs} label={`${partName(part.from, part.role)}: 이전과 비교`} />
            {diff.coarse && <Text variant="note">바뀐 부분이 길어서 세세하게 비교하지 않고 통째로 보여 줘요.</Text>}
          </>
        )
      )}
    </Stack>
  );
}

const BREAK_WORDS: Record<Exclude<CacheBreak['kind'], keyof typeof KINDS>, string> = { model: '모델 변경', account: '계정 변경', reasoning: '추론 설정 변경', off: '캐시 꺼짐', expired: '유지 시간 만료', far: '캐시 간격 초과' };
const breakLabel = (broken: CacheBreak) => ('from' in broken ? `${partName(broken.from, broken.role)} ${KINDS[broken.kind]}` : BREAK_WORDS[broken.kind]);

// Shown only once a pattern can show: two sends that broke.
export function RecurrenceNote({ recurrence }: { recurrence: CacheRecurrence }) {
  const { considered, broken, short, causes } = recurrence;
  if (broken < 2) return null;
  const top = [...causes].sort((a, b) => b.count - a.count).slice(0, 3);
  return (
    <Stack gap="related">
      <Text variant="note">{`최근 응답 ${considered}번 중 ${broken}번 캐시가 깨졌어요.`}</Text>
      <Row kind="tags">
        {top.map(({ cause: each, count }, index) => (
          <Tag key={index}>{`${breakLabel(each)} ${count}번`}</Tag>
        ))}
        {short > 0 && <Tag>{`${SHORT} ${short}번`}</Tag>}
      </Row>
    </Stack>
  );
}

export const SHORT = '캐시를 예상보다 적게 읽음';

// Nothing unless the provider read clearly less than the receipt's forecast.
export function ShortfallNote({ receipt, entry }: { receipt: Receipt; entry: LogEntry | null }) {
  const shortfall = cacheShortfall(receipt);
  if (!shortfall?.short) return null;
  const place = shortfallPlace(entry, shortfall);
  return (
    <Text variant="note">
      {`캐시에서 약 ${tokens(Math.round(shortfall.expected))} 토큰을 읽을 줄 알았는데 ${tokens(shortfall.actual)} 토큰만 읽었어요.`}
      {place && ` '${partName(place.from, place.role)}' 부분 근처부터는 캐시에서 읽지 못했어요.`}
      <Hint label={SHORT}>제공자가 캐시를 일찍 비웠거나 요청 내용을 바꿨을 수 있으니, 계속되면 다른 연결을 사용해 보세요.</Hint>
    </Text>
  );
}

const subject = ({ edit, from, role }: CachePrescription) => (edit.kind === 'lore' ? `로어북 '${loreName(edit.name)}'` : `'${partName(from, role)}'`);
const ACTIONS: Record<CachePrescription['action'], { title: string; button: string }> = {
  'after-chat': { title: '대화 뒤로 옮기기', button: '옮기기' },
  constant: { title: '항상 켜기', button: '항상 켜기' },
};
const titleOf = (prescription: CachePrescription) => `${subject(prescription)} ${ACTIONS[prescription.action].title}`;

// What the next send would pay less, against its price as it stands; null where either is unpriced or the units differ.
// An edit that mends every break leaves no breakCost, so it pays what reading the whole cache would.
function saved(now: CacheBreakCost | null, after: CacheBreakCost | null): Cost | null {
  const paid = after?.paid ?? now?.whole;
  if (!now || !paid || paid.unit !== now.paid.unit) return null;
  const amount = now.paid.amount - paid.amount;
  return amount > 0 ? { ...now.paid, amount } : null;
}

function preview({ edit }: CachePrescription): ReactNode {
  if (edit.kind === 'lore') {
    if (edit.field === 'constant') return <Text>키워드와 상관없이 매번 보내서 그만큼 토큰이 들어요.</Text>;
    return <TextDiff runs={cacheDiff(edit.before, edit.after).runs} label="항목 내용: 변경 전후" />;
  }
  return <Text>프롬프트에서 이 블록의 순서가 대화 뒤로 바뀌어요.</Text>;
}

// Applying one changes the bot (design §4.4, 캐시 보호 ruling 1): only on the user's press, with 되돌리기.
export function Prescriptions({ prescriptions, cost: now }: { prescriptions: CachePrescription[] | null | undefined; cost: CacheBreakCost | null }) {
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState<number | null>(null);
  if (prescriptions === null) return <Text variant="note">고치는 방법을 계산하지 못했어요.</Text>;
  if (!prescriptions?.length) return null;
  async function apply(prescription: CachePrescription) {
    const done = await applyCacheEdit(store, prescription.edit);
    if (!done.ok) return toast.failed(done, '적용하지 못했어요.');
    toast.undoable('적용했어요.', () => applyCacheEdit(store, done.data), titleOf(prescription));
  }
  const ranked = prescriptions
    .map((prescription) => ({ prescription, less: saved(now, prescription.cost) }))
    .sort((a, b) => (b.less?.amount ?? -1) - (a.less?.amount ?? -1));
  return (
    <Section level={3} title="해결 방법" help="여러 개를 함께 고치면 아끼는 금액이 각각의 합과 다를 수 있어요.">
      <List label="해결 방법">
        {ranked.map(({ prescription, less }, index) => (
          <ListItem
            key={index}
            title={titleOf(prescription)}
            note={`캐시에서 읽음 ${tokens(prescription.before.read)} → ${tokens(prescription.after.read)}`}
            tags={less ? [`${cost(less)} 절약`] : []}
            expanded={open === index}
            onClick={() => setOpen(open === index ? null : index)}
            detail={
              open === index && (
                <Stack gap="related">
                  {preview(prescription)}
                  <Row kind="actions">
                    <Button variant="secondary" size="sm" onClick={() => void apply(prescription)}>
                      {ACTIONS[prescription.action].button}
                    </Button>
                  </Row>
                </Stack>
              )
            }
          />
        ))}
      </List>
    </Section>
  );
}
