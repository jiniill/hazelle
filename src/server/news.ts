import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.19',
  title: '에셋 미리보기에서 이전·다음 넘기기와 삽화 크게 보기 밀어 넘기기를 추가했어요',
  text: `## 에셋 미리보기 넘기기
- **이전·다음 버튼**: 캐릭터 편집이나 **설정 › 모듈**의 **에셋**에서 에셋을 눌러 미리보기 창을 열었을 때, 에셋이 2개 이상이면 상단 **닫기** 버튼 옆에 현재 순서와 **이전**·**다음** 버튼이 표시돼 창을 닫지 않고 이어서 볼 수 있어요.
- **키보드와 밀어 넘기기**: 미리보기 창에서 키보드 좌우 방향키(\`←\`·\`→\`)를 누르거나 터치 화면을 한 손가락으로 좌우로 밀어 이전·다음 에셋으로 넘길 수 있어요.
- **넘기는 순서**: **에셋** 목록에 보이는 이름순으로 넘어가며, 마지막 에셋에서 **다음**으로 넘기면 첫 에셋으로 이어져요. **에셋 검색** 중에는 검색 결과에 보이는 에셋끼리만 넘어가요.

## 그 밖의 개선
- **삽화 크게 보기 밀어 넘기기**: 채팅에서 여러 버전이 있는 **삽화**를 눌러 **크게 보기**로 열었을 때, **이전**·**다음** 버튼과 좌우 방향키(\`←\`·\`→\`)뿐 아니라 터치 화면에서 좌우로 밀어서도 다른 버전으로 넘길 수 있어요.`,
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
