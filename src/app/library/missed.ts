import type { PresetUnsupported } from '../../engine/import/preset';
import type { MoveUnsupported, MoveUnsupportedKind, SillyTavernRegexKind, Unsupported, UnsupportedKind } from '../../engine/import/types';
import type { Dropped } from '../../runtime/chat/chat-log';
import { SLOT } from '../common/prompt-words';
import { CAST, COMMAND, inSettings, SCRIPTS } from '../common/words';

const TAVERN_REGEX = `SillyTavern ${SCRIPTS.regex}`;
const SILLYTAVERN_REGEX: Record<SillyTavernRegexKind, (count: number) => string> = {
  'regex-placement': (count) => `슬래시 명령·월드 인포·추론에 쓰던 ${TAVERN_REGEX} ${count}개`,
  'regex-role': (count) => `한쪽 메시지에만 쓰던 ${TAVERN_REGEX} ${count}개(양쪽에 적용됨)`,
  'regex-depth': (count) => `깊이 제한이 있는 ${TAVERN_REGEX} ${count}개(모든 깊이에 적용됨)`,
  'regex-trim': (count) => `잘라낼 문자열이 있는 ${TAVERN_REGEX} ${count}개`,
  'regex-escape': (count) => `패턴 속 매크로를 이스케이프하던 ${TAVERN_REGEX} ${count}개`,
};

const UNSUPPORTED: Record<UnsupportedKind, (count: number) => string> = {
  'extra-icon': (count) => `추가 아이콘 ${count}개`,
  emotion: (count) => `감정 표현 ${count}개`,
  voice: (count) => `음성 ${count}개`,
  'other-asset': (count) => `그 밖의 에셋 ${count}개`,
  'missing-asset': (count) => `파일에 없는 에셋 ${count}개`,
  'unsupported-file': (count) => `지원하지 않는 형식의 파일 ${count}개`,
  'refused-picture': (count) => `올리지 못한 이미지 ${count}개`,
  'refused-video': (count) => `올리지 못한 영상 ${count}개`,
  'prebuilt-asset-command': () => '에셋 명령',
  'large-portrait': () => '큰 초상화로 보기',
  'view-screen': () => '추가 캐릭터 스크린(감정 이미지·이미지 생성)',
  'depth-prompt': () => '깊이 프롬프트',
  'disable-ui-prompt': (count) => `@@disable_ui_prompt ${count}곳`,
  'cbs-tag': (count) => `지원하지 않는 ${COMMAND} ${count}개`,
  'regex-stage': (count) => `지원하지 않는 단계의 정규식 ${count}개`,
  ...SILLYTAVERN_REGEX,
  module: () => '읽지 못한 모듈',
  'toggle-line': (count) => `읽지 못한 토글 줄 ${count}개(토글에서 수정할 수 있음)`,
  mcp: () => 'MCP 서버 연결',
  cjs: () => '모듈 자바스크립트(cjs)',
  hazelle: () => '파일이 바뀌어 읽지 않은 헤이젤 설정과 모듈',
};

const MOVE_UNSUPPORTED: Record<MoveUnsupportedKind, (count: number) => string> = {
  'group-chat': (count) => `그룹 채팅 ${count}개`,
  memory: (count) => `장기 기억을 다 옮기지 못한 채팅 ${count}개`,
  inlay: (count) => `메시지 속 이미지 ${count}개`,
  'hidden-message': (count) => `숨김·코멘트 메시지 ${count}개(일반 메시지로 들어옴)`,
  'cold-missing': (count) => `백업에 없는 채팅 ${count}개`,
  'missing-picture': (count) => `백업에 없는 이미지 ${count}개`,
  'escape-output': () => `출력 이스케이프(응답 속 ${COMMAND}도 실행됨)`,
  'lore-depth': () => 'Risu에서 바꾼 로어북 검색 깊이(헤이젤은 5로 고정)',
  'chat-toggles': (count) => `채팅별 토글 값이 있는 채팅 ${count}개`,
  'lore-copy': (count) => `이 채팅에서만 켠 로어북 ${count}개(채팅 로어북에 사본으로 들어옴)`,
  'lore-unfound': (count) => `이 채팅에서만 켠 로어북 ${count}개(캐릭터 로어북에서 찾지 못함)`,
  'system-message': (count) => `시스템 메시지 ${count}개(봇 메시지로 들어옴)`,
  attachment: (count) => `메시지에 첨부한 파일 ${count}개`,
};

export const missedLines = (unsupported: Unsupported): string[] => unsupported.map((item) => UNSUPPORTED[item.kind](item.count));

const PRESET_UNSUPPORTED: Record<Exclude<PresetUnsupported['kind'], 'repeated-slot'>, (count: number) => string> = {
  jailbreak: (count) => `탈옥 블록 ${count}개`,
  cot: (count) => `추론 유도(CoT) 블록 ${count}개`,
  chatml: (count) => `ChatML 블록 ${count}개`,
  'cache-narrowed': (count) => `바꿔서 가져온 캐시 지점 ${count}개(메시지 하나에 두는 지점으로)`,
  'unread-item': (count) => `읽지 못한 블록 ${count}개`,
  'off-item': (count) => `꺼져 있던 블록 ${count}개`,
  'toggle-line': UNSUPPORTED['toggle-line'],
  'preset-text': (count) => `템플릿 밖의 텍스트 ${count}개(Risu에서도 보내지 않던 것)`,
  macro: (count) => `지원하지 않는 SillyTavern 매크로 ${count}개`,
  'regex-stage': UNSUPPORTED['regex-stage'],
  ...SILLYTAVERN_REGEX,
  'prompt-settings': (count) => `프롬프트 조립 설정 ${count}개`,
  settings: () => `모델과 생성 설정(${inSettings('models')}에서 정할 수 있음)`,
};

export const presetMissed = (unsupported: PresetUnsupported[]): string[] =>
  unsupported.map((item) => (item.kind === 'repeated-slot' ? `겹친 ${SLOT[item.slot].name} 블록 ${item.count}개(처음 것만 가져옴)` : PRESET_UNSUPPORTED[item.kind](item.count)));

export const cardMissed = (unsupported: Unsupported, faceless: boolean): string[] => [...(faceless ? ['이미지: 가져오지 못함'] : []), ...missedLines(unsupported)];

// The pieces of an imported file the store refused to keep (runtime/import/originals).
export const unkeptMissed = (count: number) => `보관하지 못한 원본 파일 조각 ${count}개`;

export const moveMissed = (items: MoveUnsupported[]): string[] => items.map((item) => MOVE_UNSUPPORTED[item.kind](item.count));

const DROPPED: Record<keyof Dropped, (count: number) => string> = {
  prompt: () => '프롬프트',
  persona: () => '페르소나',
  cast: (count) => `${CAST} ${count}명`,
  models: (count) => `모델 ${count}개`,
  pictures: (count) => `삽화 ${count}개`,
  inlays: (count) => `메시지 속 이미지 ${count}개`,
};

export const chatMissed = (dropped: Dropped): string[] => (Object.keys(DROPPED) as (keyof Dropped)[]).flatMap((kind) => (dropped[kind] ? [DROPPED[kind](dropped[kind])] : []));
