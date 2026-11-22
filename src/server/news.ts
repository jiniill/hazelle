import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.11',
  title: 'Vertex AI 처리 지역을 고를 수 있어요',
  text: `## Vertex AI 처리 지역

- **지역 고르기**: Vertex AI 연결의 '세부 설정'에서 기본값인 글로벌 대신 미국이나 EU를 고를 수 있어요.
- **거절될 때 바꾸기**: 한 지역에서 요청이 거절되면 다른 지역으로 바꿔 쓸 수 있어요.
- **지역 안 처리**: 미국이나 EU를 고르면 데이터를 그 지역 안에서 처리해요.
- **할인 받기**: '할인 받기'는 글로벌에서만 쓸 수 있어요.

## 그 밖의 개선

- **설정 카드 테두리와 여백**: 목록과 설정 묶음, 카드에 옅은 테두리와 안쪽 여백을 더해 구역이 또렷해졌어요.
- **사이드바 현재 항목 강조**: 설정·캐릭터 편집기·게시판 사이드바에서 지금 보는 항목에 강조색과 왼쪽 막대가 표시돼요.`,
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
