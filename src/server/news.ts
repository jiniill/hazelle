import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.10',
  title: '요청 경로에 프록시를 추가했어요',
  text: `## 요청 경로

- **프록시 경로 추가**: 헤이젤 서버에서 429 제한을 자주 받을 때 운영자가 돌리는 미국 프록시를 한 번 더 거쳐 보내 볼 수 있지만, 효과는 아직 장담하기 어려워요.
- **시험 운영**: 지금은 시험적으로 클라우드플레어 프록시를 연결했고, 잘 안 되면 다른 프록시 방법을 준비할 계획이에요.
- **탭을 닫아도 이어지는 응답**: 프록시 경로도 서버 경로처럼 탭을 닫아도 응답이 계속 이어져요.
- **선택 전 확인**: 프록시를 고를 때 요청과 키가 한 곳을 더 거치고 제공자가 프록시 주소를 제한하거나 막을 수 있다는 확인 창이 떠요.
- **경로 설정**: 설정 › 계정의 '요청 경로'에서 서버, 브라우저, 프록시 중 고를 수 있고, 전에 '브라우저 직접 요청'을 켜 뒀다면 '브라우저'로 그대로 이어져요.

## 그 밖의 개선

- **장기 기억 전체 복사**: 장기 기억 패널의 ⋯ 메뉴에서 그 채팅의 장기 기억 전체를 글로 복사해 다른 곳에 붙여 넣을 수 있어요.
- **개인정보 처리방침 변경**: 2026년 11월 22일부터 브라우저와 프록시 요청이 어디를 거치는지 설명을 볼 수 있고, 자동 진단 항목에 요청 경로가 포함돼요.`,
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
