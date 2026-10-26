import type { CacheBreak, CacheCause, CacheDiagnosis, CacheRecurrence } from '../../model/cache';
import type { Receipt } from '../../model/chat';
import { cacheShortfall, shortfallPlace } from '../../runtime/cache-diagnosis';
import type { LogEntry } from '../../runtime/request-log';
import { tokens } from '../common/receipt';
import type { ReactNode } from 'react';
import { Hint, Row, Stack, Tag, Text, TextDiff } from '../ui';
import { partName } from './ChatSent';
import { silentReason } from './InspectModules';

type BrokenPart = CacheDiagnosis['parts'][number];

const KINDS = { changed: '달라짐', added: '추가됨', removed: '빠짐', moved: '자리 옮김' } as const;
export const breakKind = (kind: keyof typeof KINDS) => KINDS[kind];

const quoted = (value: string) => (value === '' ? '(빈 값)' : `'${value.length > 60 ? `${value.slice(0, 60)}…` : value}'`);

const VARYING = '보낼 때마다 달라지는 내용이 캐시 지점 앞에 있으면, 그 뒤는 매번 새로 저장해요. 달라지는 부분을 프롬프트 뒤쪽, 마지막 캐시 지점 뒤로 옮기면 앞부분은 계속 읽혀요.';

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
        help: '키로 켜지는 항목은 켜고 꺼질 때마다 그 뒤의 캐시가 깨져요. 자주 바뀐다면 항상 켜 두거나, 배치 깊이를 대화 뒤쪽으로 두어 앞부분 캐시를 유지하세요.',
      };
    }
    case 'moved':
      return cause.depth === null
        ? { line: '같은 내용이 다른 자리로 옮겨졌어요.', help: null }
        : { line: `깊이 ${cause.depth}에 넣는 항목이라 대화가 늘면서 자리를 옮겼어요.`, help: '깊이로 넣는 항목은 메시지가 늘 때마다 함께 밀려서, 캐시는 이 항목이 있던 자리 앞까지만 읽혀요. 깊이가 작을수록 더 많이 읽혀요.' };
    case 'hoisted':
      return { line: '시스템 메시지라 요청 맨 앞에 모아 보내요.', help: '이 연결 방식은 시스템 메시지를 모두 요청 맨 앞에 모아요. 매번 바뀌는 시스템 메시지는 그 뒤 전부를 새로 저장하게 해요. 역할을 사용자로 바꾸면 제자리에 들어가요.' };
    case 'edited':
      return { line: '대화 메시지가 수정됐어요.', help: null };
    case 'memory':
      return { line: '장기 기억이 새로 정리됐어요.', help: '장기 기억은 정리할 때마다 바뀌어서, 그때 한 번 그 뒤 캐시가 깨져요.' };
    case 'unknown':
      return { line: '원인을 짚지 못했어요.', help: '스크립트나 토큰 절약이 보낼 글을 바꿨거나, 여러 글이 합쳐진 부분이면 원인을 짚을 수 없어요. 아래에서 달라진 곳을 보세요.' };
  }
}

// The causes of the part broken names, for the sentence that names it; none for a break of the whole call (expired, model),
// whose diagnosis still lists changed parts that are not why it reads nothing. Every cause, since they compound: a lore
// entry turning on reads nothing only because its system message is hoisted to the front.
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
        <Text variant="note">직전 요청의 원문이 없어서 어떻게 바뀌었는지는 알 수 없어요.</Text>
      ) : (
        differs && (
          <>
            <Text variant="note">바뀐 곳</Text>
            <TextDiff runs={diff.runs} label={`${partName(part.from, part.role)}: 직전 요청과 비교`} />
            {diff.coarse && <Text variant="note">달라진 곳이 길어서 하나하나 맞추지 않고 통째로 보여 줘요.</Text>}
          </>
        )
      )}
    </Stack>
  );
}

const BREAK_WORDS: Record<Exclude<CacheBreak['kind'], keyof typeof KINDS>, string> = { model: '모델 바뀜', account: '계정 바뀜', reasoning: '추론 설정 바뀜', off: '캐시 꺼짐', expired: '유지 시간 지남', far: '캐시 위치가 멂' };
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

export const SHORT = '예상보다 적게 읽음';

// Nothing unless the provider read clearly less than the receipt's forecast.
export function ShortfallNote({ receipt, entry }: { receipt: Receipt; entry: LogEntry | null }) {
  const shortfall = cacheShortfall(receipt);
  if (!shortfall?.short) return null;
  const place = shortfallPlace(entry, shortfall);
  return (
    <Text variant="note">
      {`예상보다 적게 읽었어요. 약 ${tokens(Math.round(shortfall.expected))} 토큰을 읽을 줄 알았는데 ${tokens(shortfall.actual)} 토큰만 읽었어요.`}
      {place && ` '${partName(place.from, place.role)}' 부분 근처부터 읽지 못했어요.`}
      <Hint label={SHORT}>제공자가 캐시를 비웠거나, 캐시가 없는 다른 서버가 받았거나, 요청에 보이지 않는 문구를 끼워 넣었을 수 있어요. 문제가 계속되면 다른 연결을 사용해 보세요.</Hint>
    </Text>
  );
}
