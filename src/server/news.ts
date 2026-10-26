import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.5',
  title: '메시지에 텍스트 파일을 붙여 보낼 수 있어요',
  text: [
    '- 보내기 칸의 첨부 › 텍스트 파일 추가로 텍스트나 코드 파일을 붙여요. 파일을 끌어다 놓거나 복사해 붙여 넣어도 돼요.',
    '- 파일 하나에 512KB까지, UTF-8 파일만 붙일 수 있어요.',
    '- 붙인 파일은 메시지에 이름으로 보이고, 모델에는 파일 내용이 함께 가요.',
    '- 코드 블록에 언어가 적혀 있으면 색을 입혀 보여 줘요. 블록마다 복사 버튼도 생겼어요.',
    '- 파일을 가져올 때 저장하기 전에 무엇이 들어 있는지 먼저 보여 줘요. 여러 파일은 가져올 것만 골라요.',
    '- 헤이젤 나우가 이번 주 대신 최근 7일 기준으로 매일 바뀌어요. 이제 월요일에 순위가 비지 않아요.',
    '- 이에 맞춰 개인정보 처리방침을 고쳤어요. 일주일 전 순위와 비교하려고 날마다 순위를 기록하고 8일 뒤 지워요. 계정과 사람 수는 남기지 않아요.',
    '- 텍스트 토글의 기본값을 토글 편집 화면에서 바로 입력해요.',
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
