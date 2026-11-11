import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.29',
  title: '설정 창과 프롬프트 화면을 더 쓰기 편하게 다듬었어요',
  text: `## 설정 창과 API 연결
- **넓어진 설정 창**: 넓은 화면에서 **설정** 창이 화면 크기에 맞춰 더 크게 열리고 메뉴와 본문이 나란한 두 판으로 나뉘어 보여요.
- **API 연결 나란히 보기**: 넓은 화면의 **설정 › API 연결**에서 연결 목록과 선택한 연결의 상세 화면을 좌우로 나란히 볼 수 있어요.
- **제공자 목록 접기**: **새 연결**에서 주요 제공자만 보여 주고 나머지는 모든 제공자를 눌러 펼쳐 볼 수 있어요.
- **작동할 수 없는 기능 표시**: 켜 둔 기능이나 대화에 필요한 모델·프롬프트가 빠져 작동할 수 없으면 **설정** 목록의 해당 항목에 경고 아이콘이 표시돼요.

## 모델과 내 구성
- **모델 화면에서 모델 추가**: **설정 › 모델** 상단의 모델 추가 버튼에서 연결을 골라 모델을 추가하거나 새 연결을 열 수 있어요.
- **휴대폰의 공용 모델 한 줄 보기**: 휴대폰의 **설정 › 모델**에서 공용 모델 선택 카드가 한 상자의 한 줄 행으로 묶여 한눈에 보여요.
- **안 쓰는 모델 분리와 접기**: 현재 구성이 쓰지 않는 모델이 **설정 › 내 구성**에서는 안 쓰는 모델로 접히고, 모델 화면에서는 따로 나뉘어 보여요.

## 프롬프트 목록과 편집
- **프롬프트 목록 표와 우클릭 메뉴**: **설정 › 프롬프트**에서 각 프롬프트의 모델, 블록·토글 수, 사용처를 표로 한눈에 보고 우클릭 메뉴로 관리할 수 있어요.
- **상단 탭과 프롬프트 전환**: 프롬프트 편집 화면 상단 탭에서 블록과 모델·토글 설정을 오가고, 제목 옆 버튼으로 같은 종류의 다른 프롬프트를 열 수 있어요.
- **이어진 전송 순서와 블록 끼워 넣기**: **전송 순서**가 캐시 지점 단위로 이어져 보이고, 블록 사이를 가리켜 원하는 자리에 새 블록을 추가할 수 있어요.
- **블록 검색**: 프롬프트 편집의 **블록 검색**에서 블록 이름과 내용을 찾아 일치하는 위치로 이동할 수 있어요.
- **전체 읽기**: 프롬프트 편집의 **전체 읽기** 탭에서 모든 블록의 내용을 전송 순서대로 한 화면에서 읽고 눌러서 편집할 수 있어요.

## 어디서나 붙여 넣기
- **API 키 붙여 넣어 연결**: 입력창 밖 어디서나 API 키를 붙여 넣으면 제공자를 알아보고 **새 연결** 확인 창을 띄우거나 해당 키가 저장된 연결을 열어요.
- **봇 링크·파일 붙여 넣어 가져오기**: 앱 어디서나 Realm·Proton 공유 링크나 봇·프리셋 파일을 붙여 넣으면 **가져오기** 창이 열려요.

## 그 밖의 개선
- **설정 검색 경로와 강조**: **설정 검색** 결과에 소속 경로와 일치하는 글자가 강조되어 보이고 화면 항목이 개별 설정보다 위에 나와요.
- **캐릭터별 설정 사용 안내**: 캐릭터별 번역·삽화 설정을 쓰는 채팅 위에서 **설정**의 해당 기능 화면을 열면 공용 설정이 적용되지 않는다고 알려 줘요.
- **Proton 폴더에서 받을 파일 고르기**: 여러 파일이 든 Proton 공유 폴더 링크를 가져올 때 **받을 파일을 골라요** 창에서 파일 이름과 용량을 확인하고 원하는 파일만 골라 받을 수 있어요.
- **열리는 항목 화살표 표시**: 목록과 카드에서 누르면 상세 화면이나 패널이 열리는 항목 끝에 화살표가 표시돼요.
- **읽기 실패 다시 시도**: 채팅의 상태나 내보낼 내용을 불러오지 못했을 때 **다시 시도** 버튼으로 다시 읽을 수 있어요.
- **작업 모델 응답 인식**: **장기 기억** 등 백그라운드 작업 모델이 응답 앞뒤에 설명이나 괄호를 덧붙여도 결과를 정상으로 읽어 와요.
- **여러 기기에서 확인한 비용 유지**: 한 기기에서 정산된 응답 비용이 다른 기기의 조회 실패로 지워지지 않고 채팅 영수증에 남아요.
- **가져오기 완료 창 열기 버튼**: 파일을 가져온 뒤 완료 창에서 항목을 여는 버튼 이름이 **열기**로 통일됐어요.
- **이름 없는 모듈 파일 이름**: 이름을 짓지 않은 모듈을 내보낼 때 파일 이름이 \`모듈.risum\`으로 저장돼요.
- **튜토리얼 말풍선 위치**: 튜토리얼 안내 말풍선이 입력 전의 비활성화된 버튼을 가리지 않아요.`,
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
