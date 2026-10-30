import { ACTS, importOf, newOf } from '../../common/acts';
import { LABS } from '../../common/labs';
import { NUMBER } from '../../common/settingWords';
import { ANSWER_INSTRUCTION_LABEL, BIN, BOARD, CHAT_DETAIL, DEFAULT_MODELS, DIRECT_CONNECTION, FEATURE_NAMES, FEATURES_TITLE, LORE_SCAN_WORDS, MODEL_ROLES, MODEL_SETTINGS, NETWORK, NOTICES, PAGES, PICTURE_INPUT, PRE_READ, PULSE, RETRY_COUNT, SCOPE, SCRIPTS, SET_DEFAULT, SHARE, STAGE_NAMES, TOOL, TRANSLATOR_NOTE } from '../../common/words';
import { PROFILE_LABELS, PROFILE_ROWS } from '../../models/profileRows';
import type { Feature } from '../../../model/features';
import type { Settings } from '../../../model/settings';
import { availableFeatures } from '../../../runtime/features';
import { BIN_PLACE, type Route, type SettingsPage } from '../routes';

// 설정 검색's index: the section titles and setting labels each page shows, beside its own label. terms.test.ts fails on
// a literal label a page shows and this does not hold; a label given as a constant is only held by being named here.
// A row on one item's page (a connection, a model) sits here under the list that leads to it, since no item is implied.
const TERMS: Record<SettingsPage, string[]> = {
  models: [DEFAULT_MODELS, SCOPE.default, MODEL_ROLES.main, MODEL_ROLES.aux, MODEL_ROLES.embed, '추가한 모델', MODEL_SETTINGS, '프롬프트별 지정 모델', '모델 이름', '모델 ID', '이미지 설정', PICTURE_INPUT],
  connections: ['모델', '계정', '계정 추가', '그룹', '전환일', '사용량과 한도', RETRY_COUNT, '사용 내역', '연결 이름', '키 변경', '모델 ID로 추가'],
  chat: [FEATURES_TITLE, ...Object.values(CHAT_DETAIL), RETRY_COUNT, '모델 도구 호출 횟수', '사용량 표시', ANSWER_INSTRUCTION_LABEL, ...Object.values(LORE_SCAN_WORDS).map(({ label }) => label)],
  labs: ['실험 중인 기능', ...LABS.map(({ name }) => name)],
  prompts: ['기본 프롬프트', 'Risu 프리셋 가져오기', '새 프롬프트'],
  personas: [newOf('페르소나'), importOf('페르소나'), '삽화 프로필'],
  modules: [newOf('모듈'), importOf('모듈'), '로어북', SCRIPTS.regex, SCRIPTS.triggers, '토글', '스타일'],
  plugins: [newOf(TOOL), importOf(PAGES.plugins), NETWORK],
  display: ['미리보기', '프리셋', '내 프리셋', '시스템 설정 연동', '밝은 모드일 때', '어두운 모드일 때', '색', '테마', '배경', '글자', '대사', '강조', '이미지', '이미지 가리기', '가로 이미지는 꽉 채우기', '삽화를 본문에 넣기', '이미지 위치', '캐릭터 이미지 크게 보기', '이미지 최대 폭', '텍스트', '글꼴', '글자 크기', '줄 간격', '읽기 폭', '대사 따옴표'],
  controls: ['스크롤할 때', '응답 수신 시', '자동 스크롤', '헤더 숨기기', '입력창 접기', '빠른 스크롤 막대', '메시지 이동 버튼', '내 메시지에서도 멈추기', '입력창', 'Enter로 보내기', '단축키', '단축키 목록'],
  sounds: ['알림음', '세부 설정', '응답이 시작될 때', '응답이 도착했을 때', '번역이 끝났을 때'],
  account: ['저장 공간', PAGES.usage, '잠그기', '로그아웃', '다른 기기에서 로그아웃', '백업', '전체 백업', ACTS.export.label, 'Risu로 옮길 파일', importOf('백업'), '이전 시점으로 복원', SHARE.list, NOTICES.from, BOARD.title, BOARD.mine, BOARD.toOperator, '새 소식', '앱 정보', '버전', PULSE.sharing, '문제 진단', '탈퇴', '계정 삭제'],
  admin: ['서비스', '가입 정원', '계정당 텍스트 한도', '계정당 이미지 한도', '백업 폴더', '관리 도구', `모두에게 ${NOTICES.send}`, '링크 보류', '파일 차단', '계정', '게시판', '손님 글쓰기', '기록', NOTICES.received, '운영자에게만 온 글', '방문자 통계', '가입 주별 재방문'],
};

const FEATURE_TERMS: Record<Feature, string[]> = {
  translate: ['응답 번역', '응답 번역 언어', '내 메시지 번역', '내 메시지 번역 언어', '원문 함께 보기', '반전 모드', TRANSLATOR_NOTE, '번역 프롬프트', '번역 모델'],
  illustrate: ['자동 삽화', '이미지 모델', '페르소나 시점', '만화 형식', '유료 생성 시 확인 생략', '삽화 프롬프트', '장면 모델', '삽화 수'],
  memory: ['기록 최대 분량', '임베딩 모델로 찾는 기록', '원문으로 보낼 최근 대화', '한 번에 정리할 분량'],
  mascot: ['마스코트 프롬프트'],
  preread: [`${PRE_READ} 모델`, '요약할 대상', '원문으로 유지할 최근 대화', '한 번에 요약할 분량', '추론 최소화', `${PRE_READ} 프롬프트`],
  agents: Object.values(STAGE_NAMES),
};

// Words people search for that no screen shows, by the label they find. The result shows the label.
const HIDDEN: Record<string, string[]> = {
  [PROFILE_ROWS.cache]: ['캐싱'],
  글꼴: ['폰트'],
  테마: ['다크', '라이트'],
  [FEATURE_NAMES.memory]: ['메모리'],
  [NUMBER.temperature.label]: ['temperature'],
  [NUMBER.maxOutput.label]: ['최대 토큰'],
  [PAGES.connections]: ['API 키'],
};

// where: names the place when it is not under this page, as 휴지통 is not.
type Subpage = { label: string; where?: string; route: Route; terms: string[] };

// A page's own pages: a hit on one of their labels or terms opens that page. Which 모델 설정 a row's term means is not
// implied either, so it opens the default one, and 모델 when there is none, whose card makes one.
export const subpages = (settings: Settings, profiles: readonly { id: string }[]): Partial<Record<SettingsPage, Subpage[]>> => {
  const profile = profiles.find(({ id }) => id === settings.profile);
  return {
    models: [{ label: `기본 ${MODEL_SETTINGS}`, route: profile ? { kind: 'profile', id: profile.id } : { kind: 'models' }, terms: [...PROFILE_LABELS, '사용 중인 모델', SET_DEFAULT] }],
    connections: [{ label: newOf('연결'), route: { kind: 'add-connection' }, terms: ['통합 API 게이트웨이', '제공자 직접 연결', '구독 계정 연결', '이 컴퓨터의 모델 서버', '목록에 없는 제공자', DIRECT_CONNECTION] }],
    chat: availableFeatures(settings).map((feature) => ({ label: FEATURE_NAMES[feature], route: { kind: 'feature', feature }, terms: FEATURE_TERMS[feature] })),
    account: [{ label: BIN, where: '캐릭터 둘러보기', route: { kind: 'gallery', place: BIN_PLACE }, terms: [] }],
  };
};

// where: the page that holds the term, unless the term is that page's own label.
export type Hit<Place> = { term: string; place: Place; where: string | undefined; to: Route };

export const hitsOf = <Place extends { page: SettingsPage; label: string; route: Route }>(places: readonly Place[], subs: ReturnType<typeof subpages>): Hit<Place>[] =>
  places.flatMap((place) => [
    ...[place.label, ...TERMS[place.page]].map((term) => ({ term, place, where: term === place.label ? undefined : place.label, to: place.route })),
    ...(subs[place.page] ?? []).flatMap((sub) =>
      [sub.label, ...sub.terms].map((term) => ({ term, place, where: term === sub.label ? (sub.where ?? place.label) : `${place.label} › ${sub.label}`, to: sub.route })),
    ),
  ]);

export const hitTexts = ({ term }: { term: string }) => [term, ...(HIDDEN[term] ?? [])];
