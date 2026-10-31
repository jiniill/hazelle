import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.3',
  title: '메시지를 수정하지 않았는데 원문만 달라진 장기 기억 기록은 빼지 않고 계속 보내요',
  text: [
    "- 메시지를 수정하거나 다른 버전으로 바꾸지 않았는데 변수·'스크립트'·'명령어' 등으로 원문이 정리할 때와 달라진 경우에는, '기록'과 '챕터'를 '원문 바뀜'으로 빼거나 다시 요약하지 않고 계속 보내요. '기록' 목록에는 '원문 불일치'로 표시되고, 항목을 열면 '원문이 정리할 때와 달라요.' 안내와 '원문에서 다시 만들기' 버튼이 나와요.",
    "- '장기 기억'에서 '챕터'의 '원문에서 다시 만들기'가 진행 중일 때 화면을 새로고침하거나 다시 연 뒤, 작업이 끝나기 전에 그 '챕터'의 내용을 편집하거나 '고정'·'이 챕터 삭제'를 해도 완료된 결과가 편집한 내용을 덮어쓰지 않아요.",
  ].join('\n'),
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
