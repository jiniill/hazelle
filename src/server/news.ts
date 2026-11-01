import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.9',
  title: '채팅 입력창에 둘 도구를 선택하고, 고정한 토글을 버튼 하나로 모았어요',
  text: `- 채팅 입력창 아래 도구 줄 끝의 ⋯ 버튼을 눌러 '입력창에 둘 도구'에서 '첨부', '페르소나', '노트', '번역', '삽화', 플러그인 버튼을 체크해 입력창에 둘 것만 선택하고 순서를 바꿀 수 있어요. 순서는 마우스로 끌거나 위아래 화살표로 바꾸며, 선택한 목록과 순서는 계정에 저장돼 모든 채팅에 적용돼요.
- 체크를 해제해 입력창에서 숨긴 도구도 ⋯ 버튼의 '입력창에 둘 도구' 목록에서 '열기'(플러그인은 '열기' 또는 '실행')를 눌러 쓸 수 있어요. 숨긴 도구가 이 채팅에서 켜져 있거나 설정돼 있으면 기능은 계속 작동하고 ⋯ 버튼과 목록에 점이 표시되며, 실행 중인 플러그인은 숨겨 두었어도 입력창에 '멈추기' 버튼이 나와요.
- '토글' 패널에서 '입력창에 고정'한 토글이 입력창에 개별 버튼으로 나열되던 것에서 '토글 N개' 버튼 하나로 묶였어요. 이전에는 입력창에서 토글마다 버튼을 눌러 바꿨지만, 이제는 '토글 N개'를 눌러 '고정한 토글' 패널을 연 뒤 스위치와 선택지를 바꿔요.`,
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
