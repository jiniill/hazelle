import type { StatusBlock, StatusDefinition, StatusField, StatusWriter } from '../../model/status';
import type { DraftProblem, FieldDraft, FieldKind } from './statusDraft';
import { FIELD_ERRORS } from './words';

// The words of the 상태 definition editor (design §6.1 part 1), all placeholders until the copy batch.
export const STATUS_KIND: Record<FieldKind, { label: string; description: string }> = {
  gauge: { label: '게이지', description: '범위가 있는 숫자예요. 호감도나 HP처럼요.' },
  number: { label: '숫자', description: '범위가 없는 숫자예요. 소지금이나 레벨처럼요.' },
  text: { label: '글', description: '한 줄 글이에요. 장소나 속마음처럼요.' },
  stage: { label: '단계', description: '정해 둔 것 중 하나예요. 기분이나 관계처럼요.' },
  list: { label: '목록', description: '여러 항목이에요. 소지품이나 할 일처럼요.' },
};
export const STATUS_KINDS = Object.keys(STATUS_KIND) as FieldKind[];

export const STATUS_TONE: { value: FieldDraft['tone']; label: string }[] = [
  { value: '', label: '기본' },
  { value: 'warm', label: '따뜻한 색' },
  { value: 'cool', label: '차가운 색' },
  { value: 'fresh', label: '싱그러운 색' },
];

export const STATUS_WRITER: Record<StatusWriter, { label: string; description: string }> = {
  after: { label: '응답 뒤에', description: '응답이 저장된 뒤 보조 모델이 따로 써요.' },
  with: { label: '응답과 함께', description: '대화 모델이 응답 끝에 함께 써요.' },
};

export const STATUS_PROBLEM: Record<DraftProblem, string> = {
  name: FIELD_ERRORS.name,
  range: '최소는 최대보다 작은 숫자여야 해요.',
  start: '시작 값이 이 필드에 맞지 않아요.',
  labels: '단계를 둘 이상 적어 주세요.',
};

export const STATUS_WORDS = {
  field: '필드',
  group: '묶음',
  log: '기록',
  preview: '미리 보기',
  basics: '기본',
  name: '이름',
  writer: '쓰는 방식',
  types: '유형',
  blank: '빈 상태',
  none: '상태가 없어요.',
  noFields: '필드가 없어요.',
  remove: '상태 삭제',
  removeAsk: '이 상태를 삭제할까요?',
  removeNote: '정의만 사라지고, 채팅에 기록된 값은 남아요. 같은 정의를 다시 만들어도 이어지지 않아요.',
  min: '최소',
  max: '최대',
  start: '시작 값',
  startNone: '없음',
  unit: '단위',
  change: '변한 만큼 받기',
  changeNote: '모델이 새 값 대신 +3, -2처럼 변한 양을 적어요.',
  main: '대표',
  mainNote: '크게 보이고, 상태창을 접어도 남아요.',
  tone: '색',
  labels: '단계',
  checked: '체크 목록',
  checkedNote: '항목마다 끝냈는지 표시해요.',
  open: '새 기록 받기',
  openNote: '모델이 이야기에 나온 것을 더하고 뺄 수 있어요.',
  members: '처음부터 있는 기록',
  follow: '로어북 따르기',
  followNote: '고른 로어북 폴더의 항목마다 기록이 하나씩 생겨요. 폴더에 항목을 더하면 기록도 늘어요.',
  followNone: '안 함',
  followGone: '없는 폴더',
  view: '보기',
  frame: '틀',
  mood: '분위기',
  noViews: '보기가 없어요. 없으면 전부를 카드 하나에 보여 줘요.',
  noGroups: '묶음이 없어요.',
  noLogs: '기록이 없어요.',
  blankNote: '필드부터 직접 만들어요.',
  sample: '예시',
  block: '블록',
  noBlocks: '블록이 없어요.',
  inside: '안에 추가',
  moveTo: '다른 곳으로 옮기기',
  moveToNote: '고른 곳의 맨 아래로 옮겨요.',
  look: '모양',
  lookAuto: '틀에 맞춤',
  all: '전체 보기',
  allNote: '끄면 최근 응답에서 늘어난 줄만 보여요.',
  shows: '보여 줄 필드',
  radarNote: '게이지를 셋 이상 선택해 주세요.',
  tabNames: '탭 이름',
  gone: '없는 항목',
  app: '휴대폰 앱',
  appNone: '상태창에 표시',
  appNote: '휴대폰 앱으로 두면 상태창 대신 채팅의 휴대폰에 나와요.',
  chatBy: '대화 상대',
  chatByNote: '이 필드의 값이 같은 줄끼리 한 대화가 돼요.',
  chatFrom: '보낸 사람',
  chatFromNote: '여럿이 있는 대화에서 말풍선 위에 이름으로 보여요.',
  chatMine: '내가 보낸 메시지',
  chatMineNote: '이 단계인 줄은 내가 보낸 메시지로 반대편에 그려요.',
  chatNone: '없음',
  chatReply: '답할 때 넣을 말',
  chatReplyNote: '대화에서 답하기를 누르면 입력창에 들어가요. {{name}}은 대화 이름으로 바뀌어요.',
} as const;

type FieldLook = NonNullable<Extract<StatusBlock, { kind: 'field' }>['look']>;
type RecordsLook = NonNullable<Extract<StatusBlock, { kind: 'records' }>['look']>;
export const STATUS_LOOK: Record<FieldLook, string> = { bar: '막대', segments: '칸', ring: '고리', hearts: '하트', stars: '별', thought: '속마음', scale: '눈금' };
// The looks a field's kind takes; a number and a list have the 틀's alone.
export const FIELD_LOOKS: Partial<Record<FieldKind, FieldLook[]>> = { gauge: ['bar', 'segments', 'ring', 'hearts', 'stars'], text: ['thought'], stage: ['scale'] };
export const STATUS_RECORDS_LOOK: Record<RecordsLook, string> = { cards: '카드', rows: '줄', table: '표' };
export const STATUS_LOG_LOOK: Record<NonNullable<Extract<StatusBlock, { kind: 'log' }>['look']>, string> = { feed: '피드' };
export const STATUS_BLOCK: Record<Exclude<StatusBlock['kind'], 'field' | 'records' | 'log'> | 'tab', string> = { head: '머리줄', radar: '레이더', choices: '선택지', chat: '대화', section: '구역', tabs: '탭 묶음', tab: '탭' };

// A block as a row of its view's list: what it shows, then its kind and how.
export function blockWords(definition: StatusDefinition, block: StatusBlock): { title: string; description: string } {
  const field = (id: string) => definition.fields.find((each) => each.id === id)?.name ?? STATUS_WORDS.gone;
  const log = (id: string) => definition.logs.find((each) => each.id === id);
  const how = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' · ');
  switch (block.kind) {
    case 'field':
      return { title: field(block.field), description: how(STATUS_WORDS.field, block.look && STATUS_LOOK[block.look]) };
    case 'head':
    case 'radar':
      return { title: STATUS_BLOCK[block.kind], description: block.fields.map(field).join(' · ') };
    case 'choices':
      return { title: STATUS_BLOCK.choices, description: field(block.field) };
    case 'records':
      return { title: definition.groups.find(({ id }) => id === block.group)?.name ?? STATUS_WORDS.gone, description: how(STATUS_WORDS.group, block.look && STATUS_RECORDS_LOOK[block.look]) };
    case 'log':
      return { title: log(block.log)?.name ?? STATUS_WORDS.gone, description: how(STATUS_WORDS.log, block.look && STATUS_LOG_LOOK[block.look], block.all && STATUS_WORDS.all) };
    case 'chat':
      return { title: log(block.log)?.name ?? STATUS_WORDS.gone, description: how(STATUS_BLOCK.chat, log(block.log)?.fields.find(({ id }) => id === block.by)?.name ?? STATUS_WORDS.gone) };
    case 'section':
      return { title: block.name, description: STATUS_BLOCK.section };
    case 'tabs':
      return { title: STATUS_BLOCK.tabs, description: block.tabs.map(({ name }) => name).join(' · ') };
  }
}


const range = (field: Extract<StatusField, { kind: 'gauge' }>) => `${field.min}~${field.max}`;

// A field as one line under its name: its kind, then what it is set up with.
export function fieldSummary(field: StatusField): string {
  const parts: (string | false | undefined)[] = [STATUS_KIND[field.kind].label];
  if (field.kind === 'gauge') parts.push(range(field));
  if (field.kind === 'stage') parts.push(field.labels.join(' · '));
  if ((field.kind === 'gauge' || field.kind === 'number' || field.kind === 'text' || field.kind === 'stage') && field.start !== undefined && field.start !== '') parts.push(`${STATUS_WORDS.start} ${field.start}`);
  if (field.kind === 'gauge' || field.kind === 'number') parts.push(field.unit, field.change && STATUS_WORDS.change);
  if (field.kind === 'list') parts.push(field.checked && STATUS_WORDS.checked);
  parts.push(field.main && STATUS_WORDS.main);
  return parts.filter(Boolean).join(' · ');
}
