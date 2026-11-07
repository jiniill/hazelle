import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.23',
  title: '채팅의 분기 흐름을 한눈에 보는 분기 지도를 추가했어요',
  text: `## 분기 지도
- **지도와 목록 보기**: **분기 지도**에서 원래 채팅부터 이어진 분기와 사본의 흐름을 **지도**나 **목록**으로 볼 수 있어요.
- **넓게 보기와 미리보기**: **넓게 보기**로 지도를 넓게 펼치거나 **미리보기**로 각 채팅의 마지막 메시지를 함께 볼 수 있어요.
- **채팅 이동**: 카드나 분기된 메시지 번호를 눌러 해당 채팅을 열 수 있어요.

## 채팅 사본과 목록 묶음
- **사본 만들기**: **사본 만들기**로 대화 전체를 복사한 새 채팅을 만들 수 있어요.
- **원래 채팅에 남기**: **여기서 분기**나 **사본 만들기**를 실행하면 보던 채팅에 남고, 알림의 **열기**로 새 채팅을 열 수 있어요.
- **원래 채팅 아래에 묶기**: 채팅 목록에서 분기와 사본이 원래 채팅 아래에 접혀 묶이고, 옆의 숫자를 눌러 펼쳐 볼 수 있어요.
- **분기 표시와 삭제**: 분기 구분선에 원래 채팅의 현재 이름이 표시되고, **원본 연결 끊기**로 분기 표시를 삭제할 수 있어요.

## 그 밖의 개선
- **채팅 제목 눌러 이름 바꾸기**: 채팅 상단의 제목을 누르면 **채팅 이름 바꾸기** 창이 열려요.`,
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
