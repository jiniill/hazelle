import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.21',
  title: '응답을 받는 동안 채팅 화면이 더 매끄럽게 움직여요',
  text: `## 응답 스트리밍과 이어 쓰기
- **응답 중 화면 반응**: 긴 응답이나 추론을 받는 동안에도 채팅 화면과 빠른 스크롤 막대가 매끄럽게 움직여요.
- **스트리밍 연결 복구**: 응답을 받는 도중 네트워크가 조용히 멈추면 연결을 다시 맺어 응답을 마저 받아 와요.
- **잘린 응답 감지**: Anthropic에서 컨텍스트 한도에 닿았거나 Mistral·DeepSeek에서 길이 한도로 멈춘 응답도 잘림으로 표시되어 **이어 쓰기**를 할 수 있어요.

## 그 밖의 개선
- **모델 출력 한도 처리**: 출력 한도가 컨텍스트 길이만큼 큰 모델도 **설정 › 모델**에서 응답 최대 길이를 줄이지 않고 사용할 수 있어요.
- **봇 스크립트 시간 초과**: 봇의 비동기 Lua 스크립트가 실행 시간 한도를 넘기면 멈춰 있지 않고 종료돼요.
- **장기 기억 정리**: **장기 기억**이 대화를 요약할 때 빈 항목 때문에 형식이 어긋나 실패하던 문제를 줄였어요.
- **화면 열기 오류 복구**: 일시적인 오류로 화면을 열지 못했을 때 다른 메뉴로 이동하면 새 화면을 정상적으로 열어요.`,
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
