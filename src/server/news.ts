import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.11',
  title: '앱 곳곳의 버튼, 메뉴, 설정 이름을 자연스러운 표현으로 다듬었어요',
  text: [
    "- 버튼과 메뉴에서 어색하게 풀어 썼던 말을 흔히 쓰는 표현으로 바꿨어요('기본 모델 따르기' → '기본 모델 사용', '쓰는 모델' → '사용 중인 모델', '상태창 지정 풀기' → '상태창 지정 해제', '고치는 방법' → '해결 방법').",
    "- 설정과 점검, 스크립트 도움말의 항목 이름도 뜻이 한눈에 들어오도록 정리했어요('시스템 따라 바꾸기' → '시스템 설정 연동', '대사 모양' → '대사 따옴표', '생각 줄이기' → '추론 최소화', '안 켜진 항목' → '비활성 항목', CBS·Lua 설명의 '글·목록·표' → '텍스트·배열·테이블').",
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
