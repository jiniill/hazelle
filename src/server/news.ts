import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.8',
  title: 'Gemini 채팅이 정해 둔 컨텍스트 길이를 거의 다 채워 보내요',
  text: `- Google과 Vertex AI의 Gemini 채팅에서 정해 둔 컨텍스트 길이에 가깝게 대화를 담아 보내고, 오래된 메시지가 더 늦게 잘려요. 그동안은 실제 토큰 수를 배우지 못하고 넉넉히 잡은 추정치만 써서, 컨텍스트를 150,000으로 정해도 실제로는 약 95,000 토큰에서 잘렸어요.
- 컨텍스트 한도를 채운 긴 채팅은 요청마다 보내는 분량이 늘어나는 만큼 비용도 더 나와요.
- 업데이트 뒤에 끝까지 받은 응답부터 실제 토큰 수를 배우며, 응답을 한두 번 받은 뒤부터 맞춰져요. 이전 응답이나 이미지가 들어간 응답은 배우지 않아요.`,
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
