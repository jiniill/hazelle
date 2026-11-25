import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.8.3',
  title: 'TTS 기능이 추가됐어요',
  text: `## 음성

- **캐릭터 목소리로 듣기**: ElevenLabs나 Google을 연결하고 설정 › 기능 › 음성에서 켜면 캐릭터 메시지의 '듣기' 버튼으로 소리 내어 들을 수 있어요. 처음에는 꺼져 있어요.
- **자동 읽기와 대사만 읽기**: 응답이 오면 소리 내어 읽는 '자동 읽기'와 따옴표 안 대사만 읽는 '대사만 읽기'를 켤 수 있어요.
- **캐릭터별 목소리**: 채팅의 '음성' 메뉴에서 '캐릭터별 설정'을 켜면 캐릭터마다 음성 모델과 목소리를 다르게 지정할 수 있어요.
- **음성 저장과 다시 만들기**: 끝까지 들은 음성은 저장되어 다음에는 추가 호출 없이 재생하고, 다시 만들려면 메시지의 ⋯ 메뉴에서 '음성 다시 만들기'를 눌러요.

## API 연결

- **저장한 키와 토큰 확인**: 설정 › API 연결에서 '키 보기·변경'이나 Copilot 계정의 '토큰 보기'를 눌러 저장된 값을 보고 복사할 수 있어요.
- **Copilot 토큰으로 연결**: Copilot 연결 화면에서 '토큰으로 연결'을 열어 다른 앱에서 받은 OAuth 토큰을 붙여 넣을 수 있어요.

## 그 밖의 개선

- **응답 부드럽게 표시 멈춤 수정**: '응답 부드럽게 표시'를 켠 상태에서 응답이 화면을 그리는 속도보다 빨리 올 때 글자가 멈추던 문제를 고쳤어요.
- **플러그인 업데이트 시 이름·설명 반영**: 플러그인을 새 버전으로 업데이트할 때 직접 바꾸지 않은 이름과 설명이 새 버전을 따라가고, '되돌리기'로 이전 이름과 설명까지 돌아와요.
- **봇 스크립트 동작 개선**: 화면 표시 중에 바꾼 변수가 유지되고, 채팅 메시지를 일괄 수정하거나 입력 창에 기본값을 채우는 스크립트도 제대로 동작해요.`,
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
