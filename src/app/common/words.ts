import type { LeftOut } from '../../runtime/risu-export';
import type { Role } from '../../connectors/assignment';
import type { RegexScript } from '../../engine/import/types';
import type { Feature } from '../../model/features';
import type { PrereadParts } from '../../model/settings';
import type { AgentStage } from '../../model/prompt';
import { KEEP_DAYS } from '../../model/library';
import { FIRST_PROFILE_NAME } from '../../runtime/profiles';
import { PULSE_PAGE } from '../../contracts/pulse';
import type { Category, Status } from '../../contracts/board';
import { withParticle } from './particles';

// Sentences stay in their screen and are built from these; the phrases these replaced are refused by lint
// (RETIRED_COPY in eslint.config.js).
// Kept apart on purpose, not variants of one word: 빼기 takes out of a list, 삭제 deletes. 편집 opens an item's
// editor, 수정 changes a message in place. 다시 생성 asks for another reply, 다시 시도 repeats a failed or stopped
// one. 컨텍스트 길이 is the model's own, 컨텍스트 한도 the setting. 원문 is what a translation came from, 요청 원문
// the request a reply was asked with, 응답 원문 the provider's answer as it came. 사용 중 marks what is in use, 생성 중 a reply being written.

export const MODEL_ROLES: Record<Role, string> = { main: '대화 모델', aux: '보조 모델', embed: '임베딩 모델' };
export const ROLE_TAGS: Record<Role, string> = { main: '대화', aux: '보조', embed: '임베딩' };

// Task model doors lead to its prompt picker. Missing prompts lead to the prompt list,
// never directly to the auxiliary model because the task cannot run without a prompt.
export const taskModelHelp = (task: string, prompted: boolean) => ({
  text: `${task} 프롬프트에서 선택해요. 선택하지 않으면 ${MODEL_ROLES.aux}을 따라요.`,
  door: prompted ? opens(`${task} 프롬프트`) : opens(inSettings('prompts')),
});

export const NO_PICTURES = '이 모델은 이미지를 읽을 수 없어요.';
export const PICTURE_INPUT = '이미지 읽기';
export const UNKNOWN_PICTURES = `이 모델이 이미지를 읽는지 알 수 없어요. 읽는 모델이면 모델 화면에서 ${PICTURE_INPUT}를 켜 주세요.`;

export const AUX_HELP = '번역이나 장기 기억 정리처럼 대화 밖의 작업에 써요.';

export const BOT_MODELS = '봇의 모델 호출';
export const BOT_MODELS_HELP = '봇 스크립트가 대화 응답과 별개로 모델을 호출해요. 호출한 만큼 요금이 더 나올 수 있어요.';
export const CARD_WRITES = '스크립트의 카드 수정';
export const CARD_WRITES_HELP = '스크립트가 이 캐릭터의 배경 HTML을 바꿔서 저장해요. 바뀐 배경은 이 캐릭터의 모든 채팅에 적용돼요.';
export const CARD_WRITE_ASK_HELP = '허용하면 이 캐릭터의 배경 HTML이 바뀌고 모든 채팅에 적용돼요. 나중에 캐릭터 편집에서 다시 바꿀 수 있어요.';
export const BOT_STUCK = '봇 스크립트가 끝나지 않아서 멈췄어요';

export const TOOL = '플러그인';
export const RISU_PLUGIN = 'Risu 플러그인';
export const MODULE_MODELS = '모델 호출';
// Who a script's question or switch speaks for; a module that holds a tool is a plugin. Each noun takes 이.
export const ASKER = { character: '봇', module: '모듈', plugin: TOOL };
export type Asker = keyof typeof ASKER;
export const modelsHelp = (asker: Asker) => (asker === 'character' ? BOT_MODELS_HELP : `이 ${ASKER[asker]}이 대화 응답과 별개로 모델을 호출해요. 호출한 만큼 요금이 더 나올 수 있어요.`);
export const modelConsent = (asker: Asker) => `이 ${ASKER[asker]}이 모델을 추가로 호출하려고 해요`;
export const cardWriteConsent = (asker: Asker) => `이 ${ASKER[asker]}이 캐릭터 카드를 수정하려고 해요`;
export const MEMORY_CLAIM_HELP = '허용하면 이 플러그인을 쓰는 채팅에서는 기본 장기 기억이 쉬어요. 기록은 지우지 않아요.';
export const NETWORK = '외부 연결';
export const NETWORK_HELP = '켜면 이 플러그인이 대화 내용을 앱 밖으로 보낼 수 있어요. 바깥 이미지와 글꼴은 화면을 새로고침한 뒤부터 보여요.';
// A plugin's one card (design §6.10). The ruling is that it says plainly what it allows, so its line names each grant,
// the network first.
const GRANT_CLAUSES = {
  network: ['대화 내용을 앱 밖으로 보내고', '대화 내용을 앱 밖으로 보낼 수 있어요'],
  model: ['모델을 추가로 호출하고', '모델을 추가로 호출할 수 있어요'],
  memory: ['장기 기억을 대신 맡고', '장기 기억을 대신 맡을 수 있어요'],
} as const;
const GRANT_HELP = {
  network: '바깥 이미지와 글꼴은 화면을 새로고침한 뒤부터 보여요.',
  model: '내 메시지를 대신 보내 응답을 받을 수도 있어요. 호출한 만큼 요금이 더 나올 수 있어요.',
  memory: MEMORY_CLAIM_HELP,
};
export const pluginConsent = (grants: (keyof typeof GRANT_CLAUSES)[]) => `이 플러그인이 ${grants.map((grant, index) => GRANT_CLAUSES[grant][index === grants.length - 1 ? 1 : 0]).join(', ')}`;
export const pluginConsentHelp = (grants: (keyof typeof GRANT_CLAUSES)[], hosts: string[]) =>
  [...grants.map((grant) => GRANT_HELP[grant]), ...(hosts.length ? [`코드에 적힌 주소: ${hosts.join(', ')}.`] : []), '플러그인마다 한 번만 물어보고, 플러그인 화면에서 하나씩 다시 바꿀 수 있어요.'].join(' ');
export const NETWORK_CALLED = '연결한 곳';
export const TOOL_LATE = '플러그인 응답이 늦어져서 이번에는 빼고 보냈어요';
export const TOOL_STALE = '이미 다음 응답이 나와서 플러그인이 바꾼 내용은 반영하지 않았어요';
export const toolVersion = (version: string) => version || UNKNOWN;
export const TOOL_STUCK = '플러그인이 응답하지 않아서 멈췄어요';
export const TOOL_DISABLED = '플러그인이 세 번 연속 멈춰서 껐어요. 화면을 새로고침하면 다시 켜져요';
export const TOOL_FIELD_CHANGED = '플러그인이 바뀌어서 다시 설정해야 해요.';

export const SETTINGS = '설정';

export const SAVING_FILE = '파일 저장';

export const DIRECT_CONNECTION = '직접 연결';
export const NEEDS_ACCOUNT = '계정이 필요해요';
export const ACCOUNT_ONLY = '계정을 만들면 돼요';

export const PULSE = { ...PULSE_PAGE, sharing: `${PULSE_PAGE.title} 집계 참여` };

export const BIN = '휴지통';
export const BIN_KEEPS = `${KEEP_DAYS}일 안에 '${BIN}'에서 복원할 수 있어요.`;

export const COMMAND = '명령어';

export const CHANGE_IMAGE = '이미지 바꾸기';
export const UNREADABLE_IMAGE = '이 이미지는 열 수 없어요.';

export const TRANSLATOR_NOTE = '번역가의 노트';
export const NOTE_PLACEHOLDER = 'Master -> 주인님\n존댓말은 그대로 유지해 주세요';
export const noteLines = (note: string | undefined) => (note ?? '').split('\n').filter((line) => line.trim()).length;
export const NOTE_UNSENT = `번역 프롬프트에 '${TRANSLATOR_NOTE}' 블록을 추가해야 노트가 적용돼요.`;
export const ILLUSTRATE_NOTE = '삽화 노트';
export const ILLUSTRATE_NOTE_UNSENT = `삽화 프롬프트에 '${ILLUSTRATE_NOTE}' 블록을 추가해야 노트가 적용돼요.`;

export const PAGES = { models: '모델', connections: 'API 연결', chat: '채팅', prompts: '프롬프트', personas: '페르소나', modules: '모듈', plugins: '플러그인', display: '디스플레이', controls: '조작', sounds: '소리', labs: '실험실', account: '계정', usage: '사용량', admin: '운영' };

// Keep always-on module wording consistent: editable only in global settings, read-only marks elsewhere.
export const ALWAYS = '항상';

export const DEFAULT_MODELS = '기본 모델';

export const MODEL_SETTINGS = '모델 설정';

// Always name message direction: operator → account, account → operator, or operator sending.
export const NOTICES = { from: '운영자가 보낸 알림', received: '받은 알림', send: '알림 보내기' };

export const BOARD = {
  title: '게시판',
  categories: { bug: '버그', idea: '제안', question: '질문', news: '소식' } satisfies Record<Category, string>,
  statuses: { open: '열림', seen: '확인함', working: '진행 중', done: '완료', declined: '안 함' } satisfies Record<Status, string>,
  write: '글쓰기',
  mine: '내 글',
  activity: '게시판 알림',
  operatorOnly: '운영자에게만',
  toOperator: '운영자에게만 보내기',
  nickname: '닉네임',
  left: '탈퇴한 사용자',
  unnamed: '닉네임 없음',
  hidden: '가려짐',
  deleted: '삭제됨',
  vote: '추천',
  comment: '댓글',
  reply: '답글',
  author: '작성자',
};

export const TOOLS = '도구';
export const TOOL_PAGES = { translator: '번역기', calculator: '비용 계산기' };

export const inSettings = (page: keyof typeof PAGES) => `${SETTINGS} › ${PAGES[page]}`;
export const inFeature = (feature: Feature) => `${inSettings('chat')} › ${FEATURE_NAMES[feature]}`;

export const opens = (place: string) => `${place} 열기`;

// The only words for a layer's state, a tag beside the title of a panel that overrides a shared value (design, Secondary
// screens; user 2026-10-15). default: the shared layer's word, re-ruled 2026-10-16 to 공용, leaving 기본값 a field's
// starting value only.
export const SCOPE = { default: '공용', chat: '이 채팅만', character: '이 캐릭터만' } as const;
export const scopeTag = (scope: keyof typeof SCOPE) => ({ label: SCOPE[scope], tone: scope === 'default' ? 'plain' : 'accent' }) as const;

export const FEATURES_TITLE = '기능';
// 토큰 절약 (runtime/preread), a 실험실 experiment whose name may still change: every screen names it through this.
export const PRE_READ = '토큰 절약';
export const PRE_READ_HELP = `${MODEL_ROLES.aux}이 긴 내용을 요약해 ${MODEL_ROLES.main}의 입력 토큰을 아껴요. 요약에서 빠진 내용은 반영되지 않을 수 있어요. pdf-pod 플러그인에서 가져온 아이디어예요.`;
export const PRE_READ_PARTS: Record<keyof PrereadParts, string> = { chat: '대화', system: '시스템 프롬프트', lore: '로어북' };
const RESENDING = '응답을 받지 못해서 다시 보내고 있어요';
export const PRE_READ_WAITING = `${MODEL_ROLES.aux}이 긴 내용을 먼저 줄이고 있어요.`;
export const PRE_READ_RETRYING = `${MODEL_ROLES.aux}이 ${RESENDING}.`;
export const AGENTS = '에이전트';
export const AGENTS_HELP = `응답 전에 장면을 정리하거나 응답을 다듬어요. 에이전트마다 모델을 추가로 호출해요. Agents! P! 플러그인에서 가져온 아이디어예요.`;
export const CACHE_GUARD = '캐시 보호';
export const CACHE_GUARD_HELP = '캐시가 깨질 때 바로 고치는 방법과 아낄 수 있는 금액을 점검 › 캐시에서 알려 줘요.';
export const STAGE_NAMES: Record<AgentStage, string> = { pre: '전처리', post: '후처리' };
export const agentsWaiting = ({ running, retrying, total }: { running: readonly string[]; retrying: readonly string[]; total: number }) => `${withParticle((retrying.length ? retrying : running).join(', '), '이/가')} ${retrying.length ? RESENDING : '먼저 읽고 있어요'}${total > 1 ? ` · ${total - running.length}/${total} 끝남` : '.'}`;
export const polishingNow = ({ name, at, total, retrying }: { name: string; at: number; total: number; retrying?: true }) => `${withParticle(name, '이/가')} ${retrying ? RESENDING : '답을 다듬고 있어요'}${total > 1 ? ` · ${at}/${total}` : '.'}`;
export const toolWaiting = (name: string) => `${withParticle(name, '이/가')} 보낼 내용을 준비하는 중`;
export const FEATURE_NAMES: Record<Feature, string> = { translate: '번역', illustrate: '삽화', memory: '장기 기억', mascot: '마스코트', preread: PRE_READ, agents: AGENTS };

// An unset choice takes its value from somewhere else, and names it: 기본 모델 따르기, 보조 모델 따르기.
export const follows = (source: string) => `${source} 따르기`;

export const moduleName = (name: string) => name.trim() || '이름 없는 모듈';
export const promptName = (name: string) => name || '이름 없는 프롬프트';
export const DELETED_PROMPT = '삭제된 프롬프트';
export const loreName = (name: string) => name.trim() || '이름 없는 항목';
export const portraitName = (name: string) => name.trim() || '이름 없는 인물';

export const copyName = (name: string) => `${name} (사본)`;
export const copyOf = (name: string) => `'${name}'의 사본`;
export const SEE_ORIGINAL = '원본 보기';
export const ORIGINAL_GONE = '원본이 삭제됐어요';
// A delete that cannot run now stays in the ⋯, disabled, saying why.
export const cannotRemove = (because: string) => `${withParticle(because, '이라서/라서')} 삭제할 수 없어요`;

export const NOT_STARRED = '추가한 모델에 없음';

export const noStarred = (then: string) => `추가한 모델이 없어요. ${inSettings('connections')}에서 모델을 추가하면 여기서 ${then}.`;

export const CAST = '등장인물';

export const BOOKMARK = '북마크';

export const DEFAULT_VARIABLES = '기본 변수';

export const SCRIPTS = { part: '스크립트', regex: '정규식', triggers: '트리거' };
export const STAGES: Record<RegexScript['stage'], string> = { input: '입력', output: '응답', process: '요청', display: '화면' };
// One without a name, by its place in its list: the same in the editor and in 상태창 지정.
export const scriptName = (name: string, list: 'regex' | 'triggers', place: number) => name.trim() || `${SCRIPTS[list]} ${place + 1}`;

export const CHAPTER = '챕터';

export const NO_CHARACTER = '캐릭터 없이';

export const EXPORT = '내보내기';
export const CHAT_FILE = '채팅 파일';
export const IMPORT_CHATS = '채팅 가져오기';
export const ARCA_LOG = '아카라이브용 HTML';
// Risu chat files import only through the selected character's chat list, never its card importer.
export const RISU_CHAT_FILE = 'Risu 채팅 파일';
export const RISU_LOSES = 'Risu에서 캐릭터를 고른 뒤 채팅 목록의 가져오기로 열 수 있어요. 다른 버전, 수정한 첫 메시지, 번역, 이미지·삽화, 장기 기억, 등장인물, 채팅별 프롬프트·페르소나·모델 설정은 빠져요.';
export const risuLeftOut = ({ greetings, lore, unread }: LeftOut) =>
  [
    greetings ? `수정한 첫 메시지 ${greetings}개는 빠지고 캐릭터 카드의 원래 첫 메시지로 보여요.` : '',
    lore ? `Risu 로어북에서 지원하지 않는 ${CHAT_LORE} 항목 ${lore}개는 빠졌어요.` : '',
    unread ? `열리지 않는 채팅 ${unread}개는 빠졌어요.` : '',
  ].filter(Boolean).join(' ');

// Unset model settings send nothing and must never look like measured numbers.
// Use 원래 값, not 기본값, which could name the default profile.
export const ORIGINAL = '원래 값';
export const UNSET = `모델 ${ORIGINAL}`;

// A 설정 묶음's discount lane (design §6.7), a reply waiting on its batch, and one whose batch 멈추기 canceled, which
// shows an answer made before the cancel landed.
export const DISCOUNT = '할인 받기';
export const DISCOUNT_WAITING = '할인 받는 중이에요. 답이 다 만들어지면 한 번에 보여요.';
export const DISCOUNT_STOPPING = '멈추는 중이에요. 그사이에 응답이 다 만들어지면 완성된 응답을 보여 줘요.';
export const PDF_SEND = 'PDF로 보내기';

export const RETRYING = `${RESENDING}.`;
export const RETRY_COUNT = '실패하면 다시 보내기';
export const RETRY_HELP = '응답이 오기 전에 실패하면 이 횟수만큼 다시 시도해요.';
export const LORE_BUDGET_LABEL = '로어북 최대 분량';
export const CHAT_DETAIL = { reply: '응답', lore: '로어북' };
export const LORE_SCAN_WORDS = {
  tokenBudget: { label: LORE_BUDGET_LABEL, help: '켜 둔 로어북 항목을 요청마다 이만큼까지 넣어요.', unit: '토큰', amount: (count: string) => `${count} 토큰`, is: '이에요' },
  scanDepth: { label: '검색 깊이', help: '최근 메시지 몇 개에서 키워드를 찾을지 정해요.', unit: '개', amount: (count: string) => `${count}개`, is: '예요' },
  recursive: { label: '재귀 검색', help: '들어간 항목의 내용에 다른 항목의 키워드가 있으면 그 항목도 이어서 넣어요.' },
  fullWordMatching: { label: '단어 단위 검색', help: "키워드가 다른 단어의 일부일 때는 찾지 않아요. 조사가 붙은 말도 다른 단어로 봐서, '달'은 '달빛'에서도 '달이'에서도 찾지 않아요." },
} as const;
export const ANSWER = '응답 받기';
export const ANSWER_INSTRUCTION_LABEL = `${ANSWER} 지시`;
export const CHAT_LORE = '채팅 로어북';

export const defaultMark = (isDefault: boolean, name: string) => (isDefault && name.trim() !== FIRST_PROFILE_NAME ? '기본' : undefined);

export const DETAIL = '세부 설정';
export const detailLabel = (set: number) => (set ? `${DETAIL} · ${set}개 정함` : DETAIL);

export const UNKNOWN = '알 수 없음';
// 으로, not 로: every word it takes ends in a consonant, 기본값, 공용 and 원래 값.
export const resetTo = (value: string) => `${value}으로 되돌리기`;
export const RESET = resetTo('기본값');
export const UNDO = '되돌리기';
export const STOP = '멈추기';
export const LOADING = '불러오는 중…';
export const SEE_ALL = '모두 보기';
export const MISSED = '못 가져온 것';
export const EMPTY_FOLDER = '비어 있는 폴더예요.';
export const SET_DEFAULT = '기본으로 정하기';

// A share link: the character ⋯ item and its dialog, 설정 › 계정's list, the link's own page and the operator's inbox.
// held: paused by a report or the operator; removed: blocked by the operator.
export const SHARE = {
  act: '링크로 공유',
  cut: '링크 끊기',
  update: '새 버전으로 바꾸기',
  received: '받은 횟수',
  list: '공유한 링크',
  held: '보류 중',
  removed: '운영자가 내림',
  cover: '미리보기 글',
  coverHelp: '링크를 붙여 넣은 곳에 이름과 제작자, 소개 첫 줄이 보여요.',
  heldNote: '신고가 들어와 운영자가 확인하는 동안 멈춘 링크예요.',
  removedNote: '운영자가 내린 링크예요.',
  goneNote: '끊겼거나 운영자가 내린 링크예요.',
  download: '파일로 받기',
  bring: '헤이젤로 가져오기',
  report: '신고',
};
