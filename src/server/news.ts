import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.3',
  title: '설정 왼쪽 목록이 짧아졌어요',
  text: `## 설정 목록
- **기능 한 줄**: 대화·번역·삽화·장기 기억·마스코트가 설정 맨 위 **기능** 한 줄로 모였고, 누르면 켬·끔과 함께 목록으로 보여요.
- **짧아진 줄**: 넓은 화면에서 왼쪽 목록의 줄이 낮아져 한 화면에 더 많이 보여요.
- **설정 검색**: 기능 안의 설정도 전처럼 찾아서 바로 열어요.

## 첫인사 순서
- **위로·아래로 옮기기**: 캐릭터 편집기의 **첫인사**에서 첫인사마다 순서를 바꿀 수 있고, 맨 위 첫인사가 새 채팅을 열어요.
- **이미 있는 채팅**: 시작한 첫인사 그대로 남아요.

## 그 밖의 개선
- **본문 간격**: 봇이 가운데에 둔 상자와 삽화가 앞 문단에 붙어 보이던 문제를 고쳤어요.`,
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
