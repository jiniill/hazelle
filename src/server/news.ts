import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.2',
  title: '왼쪽 메뉴가 가벼워졌어요',
  text: `## 왼쪽 메뉴와 도구
- **왼쪽 메뉴**: 버튼마다 있던 테두리 상자가 없어져 아이콘만 보이고, '도구' 버튼이 빠져 캐릭터 얼굴이 더 눈에 띄어요.
- **도구 위치**: 따로 열리던 도구 창이 사라져 번역기와 비용 계산기는 설정 창 맨 아래 '도구' 묶음에 들어갔고, 휴대폰에서도 목록 화면의 도구 버튼이 없어지고 설정 목록 아래쪽에 있어요.
- **번역기·비용 계산기**: 주소와 기능은 그대로이고, 설정 검색에서 '번역기'나 '계산기'를 찾아도 바로 열려요.`,
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
