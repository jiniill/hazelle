import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.19',
  title: '에셋 미리보기에서 이전·다음 넘기기를 추가했어요',
  text: `## 에셋 미리보기 넘기기
- **이전·다음 버튼**: **에셋**에서 미리보기를 열면 상단의 **이전**·**다음** 버튼으로 창을 닫지 않고 다른 에셋을 이어서 볼 수 있어요.
- **방향키와 밀어 넘기기**: 좌우 방향키를 누르거나 터치 화면을 옆으로 밀어 이전·다음 에셋으로 넘길 수 있어요.
- **보이는 순서대로 이동**: 현재 목록이나 검색 결과에 보이는 순서대로 넘어가며, 끝에 닿으면 처음과 끝이 이어져요.

## 그 밖의 개선
- **삽화 크게 보기 밀어 넘기기**: 채팅에서 여러 버전이 있는 **삽화**를 크게 볼 때도 화면을 옆으로 밀어 다른 버전으로 넘길 수 있어요.`,
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
