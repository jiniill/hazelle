import { ACTS, importOf, newOf } from '../../common/acts';
import { LABS } from '../../common/labs';
import { NUMBER, PROFILE_LABELS, PROFILE_ROWS } from '../../common/settingWords';
import { AUTO_DIAGNOSIS, ANSWER_INSTRUCTION_LABEL, BIN, BOARD, CHAT_DETAIL, DEFAULT_MODELS, DIRECT_CONNECTION, CHAT_LOOK, FEATURE_NAMES, FEATURES_TITLE, FINDINGS, IDLE_MODELS, PICTURE_PLACE, LORE_SCAN_WORDS, MODEL_ROLES, MODEL_SETTINGS, NETWORK, NOTICES, PAGES, PICTURE_INPUT, IMAGE_MODEL, COST_ESTIMATE, PRE_READ, PULSE, RETRY_COUNT, SCOPE, SCRIPTS, SET_DEFAULT, SHARE, STAGE_NAMES, STARRED, TASK_MODELS, TOOL, TRANSLATOR_NOTE, PROMPT_MODELS } from '../../common/words';
import type { Settings } from '../../../model/settings';
import { BIN_PLACE, type Route, type SettingsPage, type ToolsPage } from '../routes';
import { ROLES_TITLE } from '../../settings/setup';
import { TRANSLATE_SWITCHES } from '../../common/TranslateRows';

// 설정 검색's index: the section titles and setting labels each page shows, beside its own label; 도구's pages too.
// terms.test.ts fails on a literal label a page shows and this does not hold; a label given as a constant is only held by
// being named here. A row on one item's page (a connection, a model) sits here under the list that leads to it, since no
// item is implied.
type Page = SettingsPage | ToolsPage;
const TERMS: Record<Page, string[]> = {
  setup: [FINDINGS, ROLES_TITLE, STARRED, FEATURES_TITLE],
  models: [DEFAULT_MODELS, SCOPE.default, MODEL_ROLES.main, MODEL_ROLES.aux, MODEL_ROLES.embed, STARRED, IDLE_MODELS, MODEL_SETTINGS, '기능별 모델', PROMPT_MODELS, '모델 이름', '모델 ID', '이미지 설정', PICTURE_INPUT],
  connections: ['모델', '계정', '계정 추가', '그룹', '전환일', '사용량과 한도', RETRY_COUNT, '사용 내역', '연결 이름', '키 변경', '모델 ID로 추가'],
  chat: [...Object.values(CHAT_DETAIL), MODEL_ROLES.main, RETRY_COUNT, '모델 도구 호출 횟수', ANSWER_INSTRUCTION_LABEL, ...Object.values(LORE_SCAN_WORDS).map(({ label }) => label)],
  translate: [TRANSLATE_SWITCHES.replies, '응답 번역 언어', TRANSLATE_SWITCHES.input, '내 메시지 번역 언어', '원문 함께 보기', TRANSLATE_SWITCHES.reverse, TRANSLATOR_NOTE, '번역 프롬프트', TASK_MODELS.translate],
  illustrate: ['자동 삽화', IMAGE_MODEL, '페르소나 시점', '만화 형식', '유료 생성 시 확인 생략', '삽화 프롬프트', TASK_MODELS.illustrate, '삽화 수', PICTURE_PLACE],
  memory: ['새 채팅에서 켜기', TASK_MODELS.memory, '기록 최대 분량', '임베딩 모델로 찾는 기록', '원문으로 보낼 최근 대화', '한 번에 정리할 분량'],
  mascot: [TASK_MODELS.mascot, '마스코트 프롬프트'],
  preread: [TASK_MODELS.preread, '요약할 대상', '원문으로 유지할 최근 대화', '한 번에 요약할 분량', '추론 최소화', `${PRE_READ} 프롬프트`],
  agents: Object.values(STAGE_NAMES),
  status: [TASK_MODELS.status, '상태 프롬프트'],
  labs: ['실험 중인 기능', ...LABS.map(({ name }) => name)],
  prompts: ['기본 프롬프트', 'Risu 프리셋 가져오기', '새 프롬프트'],
  personas: [newOf('페르소나'), importOf('페르소나'), '삽화 프로필'],
  modules: [newOf('모듈'), importOf('모듈'), '로어북', SCRIPTS.regex, SCRIPTS.triggers, '토글', '스타일'],
  plugins: [newOf(TOOL), importOf(PAGES.plugins), NETWORK],
  display: [CHAT_LOOK, '사용량 표시', '캐시 표시', '미리보기', '프리셋', '내 프리셋', '시스템 설정 연동', '밝은 모드일 때', '어두운 모드일 때', '색', '테마', '배경', '글자', '대사', '강조', '이미지', '이미지 가리기', '가로 이미지는 꽉 채우기', '삽화를 본문에 넣기', PICTURE_PLACE, '캐릭터 이미지 크게 보기', '이미지 최대 폭', '텍스트', '글꼴', '글자 크기', '줄 간격', '읽기 폭', '대사 따옴표'],
  controls: ['스크롤할 때', '응답 수신 시', '자동 스크롤', '헤더 숨기기', '입력창 접기', '빠른 스크롤 막대', '메시지 이동 버튼', '내 메시지에서도 멈추기', '입력창', 'Enter로 보내기', '단축키', '단축키 목록'],
  sounds: ['알림음', '세부 설정', '응답이 시작될 때', '응답이 도착했을 때', '번역이 끝났을 때'],
  account: ['저장 공간', PAGES.usage, '잠그기', '로그아웃', '다른 기기에서 로그아웃', '백업', '전체 백업', ACTS.export.label, 'Risu로 옮길 파일', importOf('백업'), '이전 시점으로 복원', SHARE.list, NOTICES.from, BOARD.title, BOARD.mine, BOARD.toOperator, '새 소식', '앱 정보', '버전', PULSE.sharing, AUTO_DIAGNOSIS.label, '문제 진단', '탈퇴', '계정 삭제'],
  translator: ['원문', '번역 결과', '번역할 언어', MODEL_ROLES.aux, TRANSLATOR_NOTE],
  calculator: ['모델', '토큰', '가격', COST_ESTIMATE],
  admin: ['서비스', '가입 정원', '계정당 텍스트 한도', '계정당 이미지 한도', '백업 폴더', '관리 도구', `모두에게 ${NOTICES.send}`, '링크 보류', '파일 차단', '계정', '게시판', '손님 글쓰기', '기록', NOTICES.received, '운영자에게만 온 글', '자동 진단', '방문자 통계', '가입 주별 재방문'],
};

// Words people search for that no screen shows, by the label they find. The result shows the label.
const HIDDEN: Record<string, string[]> = {
  [PROFILE_ROWS.cache]: ['캐싱'],
  글꼴: ['폰트'],
  테마: ['다크 모드', '라이트 모드'],
  [FEATURE_NAMES.memory]: ['메모리'],
  [NUMBER.temperature.label]: ['temperature'],
  [NUMBER.maxOutput.label]: ['최대 토큰'],
  [PAGES.connections]: ['API 키'],
  [PICTURE_PLACE]: ['삽화 위치'],
};

// where: names the place when it is not under this page, as 휴지통 is not.
type Subpage = { label: string; where?: string; route: Route; terms: string[] };

// A page's own pages: a hit on one of their labels or terms opens that page. Which 모델 설정 a row's term means is not
// implied either, so it opens the default one, and 모델 when there is none, whose 모델 설정 section makes one.
export const subpages = (settings: Settings, profiles: readonly { id: string }[]): Partial<Record<Page, Subpage[]>> => {
  const profile = profiles.find(({ id }) => id === settings.profile);
  return {
    models: [{ label: `기본 ${MODEL_SETTINGS}`, route: profile ? { kind: 'profile', id: profile.id } : { kind: 'models' }, terms: [...PROFILE_LABELS, '사용 중인 모델', SET_DEFAULT] }],
    connections: [{ label: newOf('연결'), route: { kind: 'add-connection' }, terms: ['통합 API 게이트웨이', '제공자 직접 연결', '구독 계정 연결', '이 컴퓨터의 모델 서버', '목록에 없는 제공자', DIRECT_CONNECTION] }],
    account: [{ label: BIN, where: '캐릭터 둘러보기', route: { kind: 'gallery', place: BIN_PLACE }, terms: [] }],
  };
};

// where: what holds the term, from the outside in: its page, unless the term is that page's own label.
// seek: the row or section it names on the page it opens; a page's own label names none.
export type Hit<Place> = { term: string; place: Place; where: readonly string[]; to: Route; seek: string | undefined };

// A place's where: names the place, as Subpage's does, when it is not in 설정, as 도구's pages are not.
// The pages come before the rows on them, so a page found by its own name leads the results.
export function hitsOf<Place extends { page: Page; label: string; route: Route; where?: string }>(places: readonly Place[], subs: ReturnType<typeof subpages>): Hit<Place>[] {
  const hits = places.flatMap((place): Hit<Place>[] => [
    ...[place.label, ...TERMS[place.page]].map((term) => ({ term, place, where: term !== place.label ? [place.label] : place.where ? [place.where] : [], to: place.route, seek: term === place.label ? undefined : term })),
    ...(subs[place.page] ?? []).flatMap((sub) =>
      [sub.label, ...sub.terms].map((term) => ({ term, place, where: term === sub.label ? [sub.where ?? place.label] : [place.label, sub.label], to: sub.route, seek: term === sub.label ? undefined : term })),
    ),
  ]);
  return [...hits.filter(({ seek }) => seek === undefined), ...hits.filter(({ seek }) => seek !== undefined)];
}

export const hitTexts = ({ term }: { term: string }) => [term, ...(HIDDEN[term] ?? [])];
