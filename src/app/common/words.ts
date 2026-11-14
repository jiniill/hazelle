import type { LeftOut } from '../../runtime/export/risu-export';
import type { Role } from '../../connectors/assignment';
import type { RegexScript } from '../../engine/import/types';
import type { Feature } from '../../model/features';
import type { PrereadParts } from '../../model/settings';
import type { AgentStage } from '../../model/prompt';
import type { Use } from '../../model/usage';
import { KEEP_DAYS, type Removable } from '../../model/library';
import { FIRST_PROFILE_NAME } from '../../model/profile';
import { ADDITIONAL_MOST } from '../../engine/additional';
import { PULSE_PAGE } from '../../contracts/pulse';
import { NEWEST_RESTORE_MINUTES, OLDEST_RESTORE_DAYS } from '../../contracts/admin';
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
// A conversation prompt that picks its own models (model/prompt pinsModels), marked wherever it stands.
export const MODEL_PINNED = '모델 고정';

export const NO_PICTURES = '이 모델은 이미지를 읽을 수 없어요.';
export const PICTURE_INPUT = '이미지 읽기';
// Who serves a model behind a gateway (ConnectionType hosts).
export const HOST = '제공자';
export const UNKNOWN_PICTURES = `이 모델이 이미지 입력을 지원하는지 확인할 수 없어요. 이미지를 지원하는 모델이라면 모델 설정 화면에서 ${PICTURE_INPUT}를 켜 주세요.`;

export const MAIN_HELP = '프롬프트나 채팅에서 모델을 따로 정하지 않았을 때 쓰는 모델이에요.';
export const AUX_HELP = '번역이나 장기 기억 정리처럼 대화 밖의 작업에 써요.';
export const EMBED_HELP = '장기 기억과 추가 설명, 플러그인이 비슷한 내용을 찾을 때 써요. 모델을 바꾸면 임베딩을 다시 만들어요.';

export const BOT_MODELS = '봇의 모델 호출';
export const BOT_MODELS_HELP = '봇 스크립트가 대화 응답과 별개로 모델을 호출해요. 호출할 때마다 토큰과 비용이 추가로 사용돼요.';
// Risu's additionalText (runtime/chat/additional).
export const ADDITIONAL_TEXT = '추가 설명';
export const ADDITIONAL_TEXT_HELP = `빈 줄로 나눈 문단 중 대화 초반과 가장 관련 있는 ${ADDITIONAL_MOST}개를 ${MODEL_ROLES.embed}로 찾아 설명 뒤에 넣어요.`;
export const CARD_WRITES = '스크립트의 카드 수정';
export const CARD_WRITES_HELP = '봇 스크립트나 플러그인이 이 캐릭터의 카드(배경 HTML, 설명, 첫인사 등)를 바꿔서 저장해요. 바뀐 내용은 이 캐릭터의 모든 채팅에 적용돼요.';
export const CARD_WRITE_ASK_HELP = '허용하면 바뀐 카드가 이 캐릭터의 모든 채팅에 적용돼요. 나중에 캐릭터 편집에서 권한을 바꿀 수 있어요.';
export const BOT_STUCK = '봇 스크립트가 끝나지 않아서 멈췄어요';

export const TOOL = '플러그인';
export const RISU_PLUGIN = 'Risu 플러그인';
export const MODULE_MODELS = '모델 호출';
export const MODULE_MODEL_HELP = `${MODEL_ROLES.aux} 호출에만 써요.`;
export const OUTGOING = '보낼 메시지';
// A script's or a plugin's 테스트, run on a chat without saving.
export const TRIAL = { when: '실행 시점', run: '테스트 실행', running: '실행하는 중…', noChat: '채팅을 열지 못했어요.', failed: '결과를 만들지 못했어요.', stale: '코드가 바뀌었어요. 다시 실행하면 지금 코드로 테스트해요.', unchanged: '변경되는 내용이 없어요.' };
// Who a script's question or switch speaks for; a module that holds a tool is a plugin. Each noun takes 이.
const ASKER = { character: '봇', module: '모듈', plugin: TOOL };
export type Asker = keyof typeof ASKER;
export const modelsHelp = (asker: Asker) => (asker === 'character' ? BOT_MODELS_HELP : `이 ${ASKER[asker]}이 대화 응답과 별개로 모델을 호출해요. 호출한 만큼 요금이 더 나올 수 있어요.`);
export const modelConsent = (asker: Asker) => `이 ${ASKER[asker]}이 모델을 추가로 호출하려고 해요`;
export const cardWriteConsent = (asker: Asker) => `이 ${ASKER[asker]}이 캐릭터 카드를 수정하려고 해요`;
export const MEMORY_CLAIM_HELP = '허용하면 이 플러그인을 사용하는 채팅에서는 기본 장기 기억이 일시 중지돼요. 기존 기록은 삭제되지 않아요.';
export const NETWORK = '외부 연결';
export const NETWORK_HELP = '켜면 이 플러그인이 대화 내용을 외부 서버로 전송할 수 있어요. 외부 이미지와 글꼴은 화면을 새로고침한 뒤부터 표시돼요.';
// A plugin's one card (design §6.10). The ruling is that it says plainly what it allows, so its line names each grant,
// the network first.
const GRANT_CLAUSES = {
  network: ['대화 내용을 앱 밖으로 보내고', '대화 내용을 외부 서버로 전송할 수 있어요'],
  model: ['모델을 추가로 호출하고', '모델을 추가로 호출할 수 있어요'],
  memory: ['장기 기억을 대신 맡고', '기본 장기 기억 대신 기억을 관리할 수 있어요'],
} as const;
const GRANT_HELP = {
  network: '외부 이미지와 글꼴은 화면을 새로고침한 뒤부터 표시돼요.',
  model: '내 메시지를 대신 보내 응답을 받을 수도 있어요. 호출한 만큼 요금이 더 나올 수 있어요.',
  memory: MEMORY_CLAIM_HELP,
};
export const pluginConsent = (grants: (keyof typeof GRANT_CLAUSES)[]) => `이 플러그인이 ${grants.map((grant, index) => GRANT_CLAUSES[grant][index === grants.length - 1 ? 1 : 0]).join(', ')}`;
export const pluginConsentHelp = (grants: (keyof typeof GRANT_CLAUSES)[], hosts: string[]) =>
  [...grants.map((grant) => GRANT_HELP[grant]), ...(hosts.length ? [`코드에 적힌 주소: ${hosts.join(', ')}.`] : []), '플러그인마다 한 번만 물어보고, 플러그인 화면에서 하나씩 다시 바꿀 수 있어요.'].join(' ');
export const NETWORK_CALLED = '연결한 주소';
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
// The times a restore can go back to (contracts/admin).
export const RESTORE_SPAN = `${NEWEST_RESTORE_MINUTES}분 전부터 ${OLDEST_RESTORE_DAYS}일 전 사이`;
export const AUTO_DIAGNOSIS = { label: '자동 진단 보내기', help: '켜 두면 오류가 나거나 기억에 없는 메시지가 생겼을 때 앱 버전, 브라우저 종류, 모델, 설정값, 메시지 수와 토큰 수를 보내요. 아이디, 대화 내용, 이름, 오류 메시지는 보내지 않아요.' };

// A write's failure, before why (toast.failed).
export const SAVE_FAILED = '저장하지 못했어요.';
export const REMOVE_FAILED = '삭제하지 못했어요.';
export const CHANGE_FAILED = '바꾸지 못했어요.';
export const APPLY_FAILED = '적용하지 못했어요.';
export const UNDO_FAILED = '되돌리지 못했어요.';
// Goes to what a notice or a row points at; not the 보기 a status panel is drawn in (statusWords).
export const SEE = '보기';
// A field left without what it needs.
export const FIELD_ERRORS = { name: '이름을 입력해 주세요.', number: '숫자를 입력해 주세요.' };
export const COUNTING = '계산하는 중…';
// The spans a usage count is read over.
export const SPANS = { hour: '지난 1시간', today: '오늘', week: '이번 주', month: '이번 달', year: '올해', all: '전체' };
export const COST_ESTIMATE = '예상 비용';
// Marks a chat shows on trouble, which 운영's 자동 진단 names the same.
export const TURN_FAILED = '응답 실패';
export const MEMORY_GAP = '기억에 없음';
export const MEMORY_WORKING = '기억 정리 중';
export const CACHE_BROKEN = '캐시 깨짐';

export const RESTORES = '복원 기록';
export const REPORT_REASON = '신고 이유';
// One named thing as the object of a sentence: '루나' 캐릭터를.
export const namedObject = (name: string, noun: string) => `'${name}' ${withParticle(noun, '을/를')}`;

// A preset of the user's own: 디스플레이's looks and a toggle section's.
export const PRESET = { noun: '프리셋', save: '프리셋으로 저장', rename: '프리셋 이름 바꾸기', named: (count: number) => `내 프리셋 ${count + 1}` };

export const BIN = '휴지통';
export const PURGE = '영구 삭제';
export const BIN_KEEPS = `${KEEP_DAYS}일 안에 '${BIN}'에서 복원할 수 있어요.`;

export const COMMAND = '명령어';
export const ASSET = '에셋';

export const CHANGE_IMAGE = '이미지 바꾸기';
// Risu's backgroundHTML: a character's or a module's, past CBS and the display regex, drawn behind its chats (design §6.4).
export const BACKGROUND_HTML = '배경 HTML';
// A pick that names a preset no longer there (시스템 따라 바꾸기's slots, a character's 디스플레이).
export const PRESET_GONE = '선택한 프리셋이 삭제됐어요. 다른 프리셋을 선택해 주세요.';
export const PRESET_GONE_CHIP = '삭제된 프리셋';
export const UNREADABLE_IMAGE = '이 이미지는 열 수 없어요.';
export const BAD_PICTURE = '이 사진은 올릴 수 없어요.';
export const UNREADABLE_FILE = '파일을 읽지 못했어요.';
export const WRONG_PASSWORD = '비밀번호가 맞지 않아요.';
export const RECOVERY_KEY = '복구 키';

export const TRANSLATOR_NOTE = '번역가의 노트';
export const NOTE_PLACEHOLDER = 'Master -> 주인님\n존댓말은 그대로 유지해 주세요';
export const noteLines = (note: string | undefined) => (note ?? '').split('\n').filter((line) => line.trim()).length;
export const NOTE_UNSENT = `번역 프롬프트에 '${TRANSLATOR_NOTE}' 블록을 추가해야 노트가 적용돼요.`;
export const ILLUSTRATE_NOTE = '삽화 노트';
export const ILLUSTRATE_NOTE_UNSENT = `삽화 프롬프트에 '${ILLUSTRATE_NOTE}' 블록을 추가해야 노트가 적용돼요.`;

export const PAGES = { setup: '내 구성', models: '모델', connections: 'API 연결', chat: '대화', prompts: '프롬프트', personas: '페르소나', modules: '모듈', plugins: '플러그인', theme: '테마', display: '디스플레이', controls: '조작', sounds: '소리', labs: '실험실', account: '계정', usage: '사용 기록', admin: '운영' };

// Keep always-on module wording consistent: editable only in global settings, read-only marks elsewhere.
export const ALWAYS = '항상';
export const NOT_USED = '사용 안 함';

export const DEFAULT_MODELS = '기본 모델';
export const DEFAULT_MODELS_FAILED = `${DEFAULT_MODELS}을 바꾸지 못했어요.`;

export const MODEL_SETTINGS = '모델 설정';
// Choosing a model: the chat's chip with none chosen, and a key form's button, which the tutorial names.
export const PICK_MODEL = '모델 선택';

// A kind of the user's own things: what it is called and what it is counted in.
export const THINGS: Record<Removable, { noun: string; unit: string }> = {
  character: { noun: '캐릭터', unit: '명' },
  chat: { noun: '채팅', unit: '개' },
  prompt: { noun: PAGES.prompts, unit: '개' },
  module: { noun: PAGES.modules, unit: '개' },
  persona: { noun: PAGES.personas, unit: '개' },
  profile: { noun: MODEL_SETTINGS, unit: '개' },
};
export const makeFailed = (kind: Removable) => `${withParticle(THINGS[kind].noun, '을/를')} 만들지 못했어요.`;

// Always name message direction: operator → account, account → operator, or operator sending.
export const NOTICES = { from: '운영자가 보낸 알림', received: '신고', send: '알림 보내기' };

export const REPORT_FAILURE = '오류 제보';
export const PICTURE_NOTE = '사진은 암호화되지 않고 운영자가 볼 수 있어요. 대화 내용이 찍혔는지 확인하고 올려 주세요.';
export const DIAGNOSIS = '진단 정보';
export const DIAGNOSIS_NOTE = '대화 내용과 API 키 없이 설정값, 토큰 수, 모델, 플러그인·모듈 이름, 최근 오류만 들어가요. 오류 메시지에 입력한 내용이 일부 포함될 수 있으니 보내기 전에 확인해 주세요.';

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
  views: '조회',
  comment: '댓글',
  reply: '답글',
  author: '작성자',
};

export const TOOLS = '도구';

// A search field's name, the heading over its finds and the line when there are none.
export const searchOf = (noun: string) => `${noun} 검색`;
export const SEARCH_RESULTS = '검색 결과';
export const noResults = (words: string) => `'${words}' ${SEARCH_RESULTS}가 없어요.`;
export const CHAT_SEARCH = searchOf(THINGS.chat.noun);
export const TOOL_PAGES = { translator: '번역기', calculator: '비용 계산기' };

export const inSettings = (page: keyof typeof PAGES) => `${SETTINGS} › ${PAGES[page]}`;
export const inFeature = (feature: Feature) => `${SETTINGS} › ${FEATURE_NAMES[feature]}`;

export const opens = (place: string) => `${place} 열기`;

// The only words for a layer's state, a tag beside the title of a panel that overrides a shared value (design, Secondary
// screens; user 2026-10-15). default: the shared layer's word, re-ruled 2026-10-16 to 공용, leaving 기본값 a field's
// starting value only.
export const EVERY_CHAT = '모든 채팅에 적용돼요.';
export const ONLY_THIS_CHAT = '지금 이 채팅에만 적용돼요.';
export const SCOPE = { default: '공용', chat: '이 채팅만', character: '이 캐릭터만' } as const;
export const scopeTag = (scope: keyof typeof SCOPE) => ({ label: SCOPE[scope], tone: scope === 'default' ? 'plain' : 'accent' }) as const;
// The layers above a chat that its features and agents come down through, by the name a screen gives each.
export const LAYERS = { settings: SCOPE.default, prompt: THINGS.prompt.noun, character: THINGS.character.noun } as const;

export const FEATURES_TITLE = '기능';
// A switch's state in a line of facts.
export const onOff = (on: boolean) => (on ? '켬' : '끔');
// 디스플레이's section for how a chat's own lines show, and its row for where pictures stand (the 삽화 page's door to it).
export const CHAT_LOOK = '채팅 화면';
export const PICTURE_PLACE = '이미지 위치';
// 토큰 절약 (runtime/tasks/preread), a 실험실 experiment whose name may still change: every screen names it through this.
export const PRE_READ = '토큰 절약';
export const PRE_READ_HELP = `${MODEL_ROLES.aux}이 긴 내용을 요약해 ${MODEL_ROLES.main}의 입력 토큰을 아껴요. 요약에서 빠진 내용은 반영되지 않을 수 있어요. pdf-pod 플러그인에서 가져온 아이디어예요.`;
export const PRE_READ_PARTS: Record<keyof PrereadParts, string> = { chat: '대화', system: '시스템 프롬프트', lore: '로어북' };
const RESENDING = '응답을 받지 못해서 다시 보내고 있어요';
export const PRE_READ_WAITING = `${MODEL_ROLES.aux}이 긴 내용을 먼저 줄이고 있어요.`;
export const PRE_READ_RETRYING = `${MODEL_ROLES.aux}이 ${RESENDING}.`;
export const AGENTS = '에이전트';
export const AGENTS_HELP = `응답 전에 장면을 정리하거나 응답을 다듬어요. 에이전트마다 모델을 추가로 호출해요. Agents! P! 플러그인에서 가져온 아이디어예요.`;
export const CACHE_GUARD = '캐시 보호';
export const CACHE_GUARD_HELP = '캐시가 깨졌을 때 해결 방법과 절약할 수 있는 금액을 점검 › 캐시에서 알려 줘요.';
export const STAGE_NAMES: Record<AgentStage, string> = { pre: '전처리', post: '후처리' };
export const agentsWaiting = ({ running, retrying, total }: { running: readonly string[]; retrying: readonly string[]; total: number }) => `${withParticle((retrying.length ? retrying : running).join(', '), '이/가')} ${retrying.length ? RESENDING : '먼저 읽고 있어요'}${total > 1 ? ` · ${total - running.length}/${total} 끝남` : '.'}`;
export const polishingNow = ({ name, at, total, retrying }: { name: string; at: number; total: number; retrying?: true }) => `${withParticle(name, '이/가')} ${retrying ? RESENDING : '응답을 다듬고 있어요'}${total > 1 ? ` · ${at}/${total}` : '.'}`;
export const toolWaiting = (name: string) => `${withParticle(name, '이/가')} 보낼 내용을 준비하는 중`;
// A row moved one place among its list's rows, from its ⋯.
export const MOVE = { up: '위로 옮기기', down: '아래로 옮기기' };
export const STATUS = '상태';
// Placeholders until the copy batch, as every word of 상태 is.
export const STATUS_REWRITE = '상태 다시 쓰기';
export const STATUS_WRITING = '쓰는 중…';
export const STATUS_MISSED = '이번 턴 갱신 안 됨';
export const STATUS_FOLD = { open: '상태창 펼치기', close: '상태창 접기' };
export const STATUS_NEXT_VIEW = '다른 보기';
export const STATUS_PIN = '위에 고정';
export const STATUS_DETAIL = '상태 상세';
export const PHONE = '휴대폰';
export const phoneFresh = (count: number) => `새 소식 ${count}`;
export const STATUS_COURSE = '변화';
export const STATUS_START = '시작';
export const STATUS_NONE = '이 채팅에는 상태가 없어요.';
export const statusOpen = (name: string) => `${name} 보기`;
export const statusLeave = (name: string) => `'${name}' 기록을 삭제할까요?`;
export const STATUS_LEAVE_NOTE = '이 기록의 값이 함께 사라져요.';
export const statusTaken = (name: string) => `'${name}' 이름은 이미 있어요.`;
export const statusEdit = (name: string) => `${name} 수정`;
export const STATUS_RANGE = (min: number, max: number) => `${min}에서 ${max} 사이로 적어 주세요.`;
export const STATUS_DONE = '끝낸 것';
export const STATUS_HELP = '봇이나 프롬프트가 정해 둔 상태(호감도, 장소 등)를 응답마다 기록해요. 만드는 중인 기능이라 아직 일부만 동작해요.';
export const FEATURE_NAMES: Record<Feature, string> = { translate: '번역', illustrate: '삽화', memory: '장기 기억', mascot: '마스코트', preread: PRE_READ, agents: AGENTS, status: STATUS };
// A feature's own model row; an agent's model is its prompt's.
export const TASK_MODELS = { translate: '번역 모델', illustrate: '장면 모델', memory: '기억 모델', mascot: '대사 모델', preread: `${PRE_READ} 모델`, status: `${STATUS} 모델` } as const satisfies Partial<Record<Feature, string>>;

// An unset choice takes its value from somewhere else, and names it: 기본 모델 사용, 보조 모델 사용.
export const follows = (source: string) => `${source} 사용`;

export const moduleName = (name: string) => name.trim() || '이름 없는 모듈';
export const promptName = (name: string) => name || '이름 없는 프롬프트';
// What stood where a deleted thing is named.
export const deletedOf = (noun: string) => `삭제된 ${noun}`;
export const DELETED_PROMPT = deletedOf(THINGS.prompt.noun);
export const loreName = (name: string) => name.trim() || '이름 없는 항목';
export const portraitName = (name: string) => name.trim() || '이름 없는 인물';

export const copyName = (name: string) => `${name} (사본)`;
export const copyOf = (name: string) => `'${name}'의 사본`;
export const SEE_ORIGINAL = '원본 보기';
export const RETRANSLATE = '다시 번역';
// Making a copy of anything: the busy toast, the failure and the result.
export const COPY_SAID = { busy: '사본 만드는 중…', failed: '사본을 만들지 못했어요.', made: '사본을 만들었어요.' };
export const ORIGINAL_GONE = '원본이 삭제됐어요';
// A delete that cannot run now stays in the ⋯, disabled, saying why.
export const cannotRemove = (because: string) => `${withParticle(because, '이라서/라서')} 삭제할 수 없어요`;

export const NOT_STARRED = '추가한 모델에 없음';
export const STARRED = '추가한 모델';
// Added models that 공용, or the chat looked at, runs nothing on (runtime/tasks/overview `used`).
export const IDLE_MODELS = '안 쓰는 모델';
// 내 구성's list of what fails now.
export const FINDINGS = '고칠 곳';
// A role no layer picks, or a 모델 설정 that sets nothing.
export const NOT_PICKED = '지정 안 함';
export const IMAGE_MODEL = '이미지 모델';
export const NO_IMAGE_MODEL = `연결된 ${IMAGE_MODEL}이 없어요.`;
// A table's column of where a thing is used.
export const USED_IN = '사용처';

export const NO_STARRED = '추가한 모델이 없어요.';
export const noStarred = (then: string) => `${NO_STARRED} ${inSettings('connections')}에서 모델을 추가하면 여기서 ${then}.`;

export const CAST = '등장인물';

export const BOOKMARK = '북마크';

export const LINEAGE = '분기 지도';
export const FORGET_ORIGIN = '원본 연결 끊기';
export const deletedChat = (name: string) => `${deletedOf(THINGS.chat.noun)} '${name}'`;

export const DEFAULT_VARIABLES = '기본 변수';
// A card's own instructions, which stand in for a prompt's 본문 and 글로벌 노트.
export const CARD_INSTRUCTIONS = { systemPrompt: '시스템 프롬프트', postHistoryInstructions: '대화 뒤 지시문' };
// A card's onboarding: questions a new chat asks, whose answers it starts from.
export const ONBOARDING = '시작 전 설문';

export const SCRIPTS = { part: '스크립트', list: '스크립트 목록', regex: '정규식', triggers: '트리거' };
// What 사용 기록's 쓰임 calls each group of calls (model/usage Use), and the calls whose purpose is not known.
export const USE_NAMES: Record<Use, string> = { reply: '대화 응답', ...FEATURE_NAMES, script: `${SCRIPTS.part}·${TOOL}`, embedding: ROLE_TAGS.embed };
export const UNKNOWN_USE = '용도를 알 수 없음';
export const STAGES: Record<RegexScript['stage'], string> = { input: '입력', output: '응답', process: '요청', display: '화면', translation: '번역' };
// One without a name, by its place in its list: the same in the editor and in 상태창 지정.
export const scriptName = (name: string, list: 'regex' | 'triggers', place: number) => name.trim() || `${SCRIPTS[list]} ${place + 1}`;

export const CHAPTER = '챕터';

export const NO_CHARACTER = '캐릭터 없이';

export const EXPORT = '내보내기';
export const CHAT_FILE = '채팅 파일';
export const IMPORT_CHATS = '채팅 가져오기';
// The ways in beside a file: a share or hub link, and Risu's whole library.
export const LINK_IMPORT = '링크로 가져오기';
export const MOVE_IN = 'Risu에서 이사';
export const READ_BACKUP = '백업 읽기';
// An import's state, as a file import and 이사 both title it.
export const IMPORTING = { busy: '가져오는 중', failed: '가져오지 못했어요', empty: '가져올 수 있는 파일이 없어요.' };
export const ARCA_LOG = '아카라이브용 HTML';
// Risu chat files import only through the selected character's chat list, never its card importer.
export const RISU_CHAT_FILE = 'Risu 채팅 파일';
export const RISU_LOSES = 'Risu에서 캐릭터를 선택한 뒤 채팅 목록의 가져오기로 열 수 있어요. 다른 버전, 수정한 첫 메시지, 번역, 이미지·삽화, 장기 기억, 등장인물, 채팅별 프롬프트·페르소나·모델 설정은 제외돼요.';
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
export const DISCOUNT_WAITING = '할인 요청으로 생성 중이에요. 응답이 완성되면 한 번에 표시돼요.';
export const DISCOUNT_STOPPING = '멈추는 중이에요. 그사이에 응답이 다 만들어지면 완성된 응답을 보여 줘요.';
export const PDF_SEND = 'PDF로 보내기';

export const RETRYING = `${RESENDING}.`;
export const RETRY_COUNT = '실패하면 다시 보내기';
export const RETRY_HELP = '응답이 오기 전에 실패하면 이 횟수만큼 다시 시도해요.';
export const LORE_BUDGET_LABEL = '로어북 최대 분량';
export const LOREBOOK = '로어북';
export const CHAT_DETAIL = { reply: '응답', lore: LOREBOOK };
// A reply's own panel and what it shows of the request and the answer.
export const REPLY_INFO = '응답 정보';
export const RESPONSE_RAW = '응답 원문';
export const CACHE_READ = '캐시에서 읽음';
export const INPUT_TRANSLATION = '입력 번역';
export const LORE_SCAN_WORDS = {
  tokenBudget: { label: LORE_BUDGET_LABEL, help: '켜 둔 로어북 항목을 요청마다 이만큼까지 넣어요.', unit: '토큰', amount: (count: string) => `${count} 토큰`, is: '이에요' },
  scanDepth: { label: '검색 깊이', help: '최근 메시지 몇 개에서 키워드를 찾을지 정해요.', unit: '개', amount: (count: string) => `${count}개`, is: '예요' },
  recursive: { label: '재귀 검색', help: '들어간 항목의 내용에 다른 항목의 키워드가 있으면 그 항목도 이어서 넣어요.' },
  fullWordMatching: { label: '단어 단위 검색', help: "키워드가 다른 단어의 일부일 때는 매칭하지 않아요. 한국어는 조사가 붙어도 다른 단어로 판단하므로, '달'을 키워드로 넣으면 '달빛'이나 '달이'에서는 활성화되지 않아요." },
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
export const IN_USE = '사용 중';
export const GENERATING = '생성 중…';
export const SAVING = '저장 중';
export const CHAT_LOADING = '채팅을 불러오는 중';
export const CHAT_SHOW_FAILED = '채팅을 화면에 표시하지 못했어요.';
export const USAGE_FAILED = '사용량을 불러오지 못했어요.';
// A loading screen's title, and the first steps of opening an account.
export const LOADING_TITLE = '불러오는 중';
export const OPEN_STEPS = { account: '계정 확인', unlock: '잠금 해제' };
export const READING_SETTINGS = '읽기 설정';
export const SECONDARY_KEYS = '보조 키워드';
// A prompt's note for chats that have none of their own.
export const DEFAULT_NOTE = '기본 노트';
export const EMPTY_VALUE = '비어 있음';
export const NO_TOGGLES = '토글이 없어요.';
export const LAB = '실험';
export const PROMPT_MODELS = '프롬프트별 지정 모델';
export const SEE_ALL = '모두 보기';
export const MISSED = '가져오지 못한 항목';
export const EMPTY_FOLDER = '비어 있는 폴더예요.';
export const SET_DEFAULT = '기본으로 지정';
export const SET_DEFAULT_FAILED = `${SET_DEFAULT}하지 못했어요.`;

// A share link: the character ⋯ item and its dialog, 설정 › 계정's list, the link's own page and the operator's inbox.
// held: paused by a report or the operator; removed: blocked by the operator.
export const SHARE = {
  act: '링크로 공유',
  cut: '링크 끊기',
  update: '새 버전으로 업데이트',
  received: '받은 횟수',
  list: '공유한 링크',
  held: '보류 중',
  removed: '운영자가 내림',
  cover: '미리보기 글',
  coverHelp: '링크를 붙여 넣은 곳에 이름과 제작자, 소개 첫 줄이 보여요.',
  heldNote: '신고가 접수되어 운영자가 확인하는 동안 일시 보류된 링크예요.',
  removedNote: '운영자가 내린 링크예요.',
  goneNote: '공유가 중단됐거나 운영자가 내린 링크예요.',
  download: '파일로 받기',
  bring: '헤이젤로 가져오기',
};
