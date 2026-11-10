import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.28',
  title: '창과 메뉴를 여닫는 움직임과 화면 전환이 더 자연스러워졌어요',
  text: `## 창·메뉴 움직임과 누름 반응
- **창과 메뉴 여닫기**: 메뉴와 대화상자, **설정** 창이 열린 자리에서 펼쳐지고 닫을 때도 들어온 쪽으로 줄어들며 사라져요.
- **사이드 패널과 알림 닫기**: 화면을 덮는 사이드 패널은 옆에서, 알림은 화면 가장자리에서 나타나고 닫힐 때도 들어온 쪽으로 사라져요.
- **접힌 영역 펼치기와 접기**: **세부 설정**이나 접힌 메시지 입력창을 열고 닫을 때 높이가 부드럽게 펼쳐지고 접혀요.
- **누름과 가리킴 반응**: 버튼과 항목에 마우스를 올리거나 손가락으로 누르는 순간 반응하고, 떼면 부드럽게 풀려요.

## 채팅 열기와 화면 전환
- **깜빡임 없는 채팅 열기**: 목록이나 다른 채팅에서 채팅을 열 때 준비되는 동안 보던 화면이 유지되어, 금방 열리는 채팅은 **채팅을 불러오는 중** 표시 없이 전환돼요.

## 그 밖의 개선
- **입력창 테두리 누르기**: 메시지 입력창의 글자 바깥 테두리나 여백을 눌러도 입력창이 펼쳐지며 커서가 들어가요.`,
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
