import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.8.7',
  title: '계정 전체 캐시 기록 화면이 추가됐어요',
  text: `## 계정 전체 캐시 기록

- **전체 캐시 현황**: 설정 › 사용 기록의 '캐시 자세히 보기'를 누르면 계정의 모든 채팅을 모아 캐시에서 읽음, 캐시 깨짐, 제공자가 놓침 비율과 토큰 양을 볼 수 있어요.
- **원인별 채팅 확인**: 캐시 깨짐 항목을 누르면 해당 채팅 목록이 열리고, 채팅을 선택해 이동할 수 있어요.
- **항목별 비교**: 프롬프트, 캐릭터, 채팅별 캐시 깨짐 비율과 모델별 제공자가 놓침 비율을 비교할 수 있어요.
- **지난 기록 읽기**: 예전 채팅의 캐시 기록이 빠져 있으면 '지난 기록 읽기'를 눌러 불러올 수 있어요.

## 캐시 진단 개선

- **구체적인 원인 표시**: 점검 › 캐시에서 블록이 바뀌거나 새로 들어가고 빠진 까닭을 메시지 수정, 메시지 삭제, 컨텍스트 한도 초과, 내용 수정, 기억 정리로 짚어 줘요.
- **매번 새로 생성**: 보낼 때마다 새로 만들어지는 항목 때문에 캐시가 깨지면 '매번 새로 생성'으로 표시해요.

## 그 밖의 개선

- **장기 기억 앞 캐시 유지**: 장기 기억에서 불러오는 내용이 바뀌어도 그 앞부분의 캐시는 유지돼요.
- **대화 모델 순위**: 모델 순위의 대화 목록에 오르는 기준이 최근 7일 사용자 수로 바뀌어 순위 밖 모델로 빠지던 모델도 순위에 올라요.`,
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
