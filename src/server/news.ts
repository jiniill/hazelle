import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.32',
  title: '사용량 화면이 사용 기록으로 새로워졌어요',
  text: `## 사용 기록
- **대화한 날과 연속 기록**: **설정 › 계정 › 사용 기록**에서 이번 달·올해·전체 기간별로 대화한 날 달력과 연속 기록을 볼 수 있어요.
- **요일과 시간**: 자주 오는 때와 가장 많이 대화한 날, 요일·시간대별 응답 흐름을 한눈에 살펴볼 수 있어요.
- **함께한 캐릭터와 비용**: 캐릭터별 응답 순위와 모델별 사용량, 캐시로 아낀 돈을 모아 볼 수 있어요.
- **접속 시간**: 헤이젤에 머문 시간을 날짜별로 기록하고 총합과 접속한 날의 평균도 보여 줘요.
- **쓰임**: 대화 응답 등 용도별 사용 비율과 횟수를 보여 주며 지난 기록도 함께 채워 줘요.

## 응답 알림
- **응답 도착 알림**: 다른 채팅이나 화면에 있을 때 응답이 도착하면 알림에서 바로 그 채팅으로 이동할 수 있어요.
- **응답 실패 알림**: 다른 화면을 보는 동안 응답을 받지 못했을 때도 알림으로 알려 주어 바로 확인할 수 있어요.

## 그 밖의 개선
- **개인정보처리방침**: 접속 시간 기록 도입에 맞춰 개인정보처리방침에 관련 안내를 추가했어요.`,
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
