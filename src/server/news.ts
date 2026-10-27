import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.8',
  title: '모델 설정에 추가 파라미터를 넣어 보낼 수 있어요',
  text: [
    '- 설정 › 모델의 모델 설정(또는 추가한 모델 화면의 모델 설정) › 세부 설정에 추가 파라미터가 생겼어요. Risu처럼 한 줄에 키=값으로 쓰거나 JSON 객체({"키": 값}) 하나로 쓰면 모델에 보내는 요청에 덮어써서 보내요.',
    '- 줄로 쓸 때 JSON 값은 앞에 json::을 붙이고, generationConfig.topA=0.1처럼 점(.)으로 안쪽 항목을 지정하거나 값을 {{none}}으로 써서 항목을 뺄 수 있어요. 읽을 수 없는 줄이나 헤더(header::) 줄은 칸 아래에 알려 주고 보내지 않아요.',
    '- iOS Safari에서 채팅, 게시판, 번역기, 편집 화면의 입력 칸을 눌렀을 때 연락처 자동 완성이 뜨던 문제를 고쳤어요.',
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
