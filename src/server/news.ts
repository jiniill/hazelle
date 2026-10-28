import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.12',
  title: '페르소나 사본을 만들 수 있고, 아이폰 Safari에서 메시지 입력 칸에 집 주소가 뜨지 않아요',
  text: [
    "- 페르소나 편집 화면의 페르소나 메뉴(⋯)에 '사본 만들기'가 생겼어요. 이미지와 설명, 켜 둔 모듈, 삽화 프로필이 새 페르소나로 복사되고, 별명과 기존 채팅은 원래 페르소나에 남아요.",
    "- 아이폰·아이패드 Safari에서 채팅의 '메시지' 입력 칸 등을 누를 때 기기에 저장된 집 주소 자동 완성이 뜨지 않아요.",
    "- 화면마다 다르게 부르던 이름을 하나로 맞추고('글 폭' → '읽기 폭', '옷' → '의상', '신고 내용' → '신고 이유', '비활성화된 링크' → '보류된 링크', '시험할 채팅' → '테스트할 채팅'), 도움말과 알림·오류 문장도 자연스러운 표현으로 다듬었어요.",
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
