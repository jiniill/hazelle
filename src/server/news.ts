import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.27',
  title: '설정에서 모델 연결을 한눈에 보는 내 구성 화면과 토글 프리셋을 추가했어요',
  text: `## 내 구성 화면
- **연결 흐름 지도**: **설정 › 내 구성**에서 API 연결·모델·역할·기능의 연결 흐름을 한눈에 보고 모델을 바로 바꿀 수 있어요.
- **고칠 곳 안내**: 모델이 비어 있거나 설정을 확인해야 하는 항목은 상단 **고칠 곳**에 모아서 알려 줘요.
- **이 채팅 구성 보기**: 채팅 화면 위에서 열면 **이 채팅**으로 전환해 현재 채팅에 적용되는 구성을 볼 수 있어요.

## 토글 프리셋과 토글 패널
- **토글 프리셋 저장과 관리**: 채팅의 **토글** 패널에 있는 **프리셋**에서 프롬프트·캐릭터·모듈별 토글 조합을 저장해 불러오거나 **현재 설정으로 덮어쓰기**·**이름 바꾸기**·**삭제**로 관리할 수 있어요.
- **기본값 바꾸기와 되돌리기**: **프리셋** 메뉴의 **기본값 바꾸기**에서 각 항목의 기본 토글 값을 고칠 수 있고, 패널 메뉴의 **기본값으로 되돌리기**로 전체 값을 초기화할 수 있어요.
- **토글 패널 위쪽 정리**: 패널 제목 아래에서 적용 범위를 한 줄로 확인하고 **전체**와 **변경** 보기를 전환해 기본값과 달라진 토글만 모아 볼 수 있어요.

## 캐릭터 카드와 봇 화면
- **배경 이미지와 배경 스타일**: 캐릭터 편집의 **배경** 탭에서 배경 이미지를 관리할 수 있고, 봇의 배경 이미지와 배경 스타일이 채팅 화면 뒤에 표시돼요.
- **시작 전 설문**: 설문이 있는 캐릭터는 새 채팅을 시작할 때나 채팅 메뉴의 **시작 전 설문**에서 질문에 답해 초기 변수를 정할 수 있어요.
- **봇 양식 제출**: 봇 메시지에 있는 입력 양식을 작성해 제출하면 봇 스크립트로 전달돼요.
- **추가 설명**: 캐릭터 편집의 **추가 설명**에 적어 둔 문단 중 대화 초반과 관련 있는 내용을 임베딩 모델로 찾아 설명 뒤에 넣어 보내요.
- **프롬프트 기본 변수**: 대화 프롬프트 편집의 **기본 변수**에서 프롬프트별 초기 변수를 정하고 Risu 프리셋으로도 주고받을 수 있어요.

## 가져오기와 Risu 호환
- **SillyTavern 가져오기**: SillyTavern의 채팅·프리셋 파일과 카드·프리셋에 담긴 정규식, 로어북 설정을 **가져오기**로 열 수 있어요.
- **비밀번호 걸린 Risu 카드**: 비밀번호가 걸린 Risu \`.rcc\` 카드는 **가져오기** 미리보기에서 비밀번호를 입력해 열 수 있어요.
- **Risu HTML 채팅 파일**: Risu에서 HTML로 내보낸 채팅 파일도 **채팅 가져오기**로 열 수 있어요.
- **번역 정규식과 Lua 트리거**: Risu의 **번역** 단계 정규식을 번역문에 적용하고, Lua 트리거의 실행 조건과 이후 효과도 그대로 유지해 실행해요.
- **보관된 원본 다시 읽기**: 원본 파일이 보관된 기존 캐릭터·모듈·프롬프트에는 새로 지원하는 배경·설문·추가 설명·기본 변수·정규식·트리거 조건이 자동으로 채워지며, 원본 보관 기능이 생기기 전에 가져온 항목은 제외돼요.
- **Risu 플러그인·스크립트 호환**: **Risu 플러그인**이 채팅 첨부 이미지·번역·모듈 정규식·페르소나 사진을 읽고 권한 동의를 거쳐 카드를 수정할 수 있으며, Lua·로어북·명령어 동작도 Risu와 더 같아졌어요.

## 그 밖의 개선
- **삽화 외모 프로필 한도 확대**: 장면 그림에 쓰는 등장인물 외모 프로필 한도가 8명에서 24명으로 늘었어요.
- **추론 요약 받기**: **모델 설정**에서 추론 요약 받기를 켜면 지원하는 모델이 추론 과정 요약을 함께 보내 줘요.
- **원문 함께 보기 코드 블록 표시**: **원문 함께 보기**를 켰을 때 번역문 안의 코드 블록이 나뉘거나 겹치지 않고 한 번만 표시돼요.
- **도구 입력 유지와 설정 검색**: **번역기**와 비용 계산기에 입력한 내용이 창을 닫아도 유지되고, 설정 검색에서도 바로 찾아 열 수 있어요.
- **폴더 이동 되돌리기**: 항목을 폴더로 옮겼을 때 알림의 **되돌리기**로 원래 위치와 순서를 복원할 수 있어요.
- **휴대폰 편집기 뒤로 가기**: 휴대폰에서 캐릭터·프롬프트·모듈을 편집할 때 **뒤로**를 누르면 열려 있던 항목이나 블록이 먼저 닫혀요.`,
};

// Once per version: a restart finds the post there. Nothing before an operator exists, since the operator writes it.
export function publishNews(db: DatabaseSync, version: string | null, news: ReleaseNews | null, now: number) {
  if (version === null || news === null || news.version !== version) return;
  db.prepare(
    `INSERT INTO posts (account_id, title, text, category, version, visibility, created_at)
     SELECT operator_account, ?, ?, 'news', ?, 'public', ? FROM installation
     WHERE operator_account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM posts WHERE category = 'news' AND version = ?)`,
  ).run(news.title, news.text, version, now, version);
}
