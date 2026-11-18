import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.5',
  title: '플러그인 패널이 채팅 위에 떠요',
  text: `## Risu 플러그인
- **채팅 위 플러그인 패널**: RisuPot의 미션 패널이나 Inlay Nexus의 뷰어처럼 화면을 직접 그리는 플러그인을 이제 채팅 위에서 볼 수 있어요.
- **패널 밖 채팅 조작**: 패널이 떠 있어도 바깥쪽 채팅은 평소처럼 누르고 스크롤할 수 있어요.
- **방해 없는 자동 숨김**: 설정 창이 채팅을 덮거나 플러그인 권한을 물을 때는 패널이 잠시 숨어요.

## 장기 기억
- **여러 장면이 담긴 기억 정리**: 메시지 하나에 장면이 여러 개 있어도 '기록 범위가 메시지 순서와 맞지 않아요' 오류 없이 기억을 정리할 수 있어요.
- **실패 위치 안내**: 그래도 기억 정리가 실패하면 몇 번째 기록이 문제인지 바로 알려 줘요.

## 그 밖의 개선
- **변수 탭 안내**: 봇 스크립트가 끝나지 않아 정규식이 꺼진 채팅에서는 변수 탭에서도 관련 안내를 볼 수 있어요.`,
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
