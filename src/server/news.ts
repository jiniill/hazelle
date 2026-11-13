import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.34',
  title: 'OpenRouter 제공자 직접 고르기',
  text: `## OpenRouter 제공자와 할인
- **제공자 고르기**: '설정 › 모델'에서 OpenRouter 모델마다 입력·출력 가격을 보고 원하는 제공자를 직접 고를 수 있어요.
- **제공자 고정**: '자동' 대신 특정 제공자를 고르면 다른 제공자로 넘어가지 않아요.
- **할인 받기**: 스위치를 켜면 '할인 가능' 꼬리표가 붙은 제공자를 더 저렴하게 쓰고, 실제로 할인 처리된 응답만 할인가로 기록돼요.

## 프리셋 통합과 편집
- **프리셋 통합**: '설정 › 디스플레이'에서 모든 프리셋이 한 목록으로 합쳐져, 쓰던 프리셋은 기본 프리셋 뒤에서 볼 수 있어요.
- **프리셋 정리**: 기본 프리셋도 카드의 '⋯' 메뉴에서 이름을 바꾸거나 앞뒤로 옮기고 삭제할 수 있어요.
- **기본 프리셋 복원**: 삭제한 기본 프리셋은 이 버튼으로 목록 끝에 다시 불러올 수 있어요.
- **시스템 설정 연동**: 기기 설정에 화면을 맞출 때 '현재 설정 저장'으로 만든 프리셋도 고를 수 있어요.

## 그 밖의 개선
- **모드**: '설정 › 디스플레이'에서 어둡게와 밝게를 고르는 줄 이름이 '모드'로 바뀌었어요.
- **메뉴 표시**: 창이나 패널, 카드 안에서 연 메뉴와 안내 말풍선이 테두리에 잘리지 않고 온전히 펼쳐져요.
- **페르소나 창**: 페르소나 관리로 이동할 때 열려 있던 페르소나 창이 자동으로 닫혀요.`,
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
