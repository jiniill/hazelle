import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.1',
  title: '고르기 전에 보는 테마 미리보기',
  text: `## 테마
- **테마 미리보기**: '설정 › 테마'의 카드에 왼쪽 메뉴·채팅 목록·메시지·입력창이 작게 그려져서 고르기 전에 차이를 볼 수 있고, 휴대폰에서는 휴대폰 화면 모양으로 보여요.
- **테마와 모드**: 테마를 고르면 모드도 함께 바뀌어 디스코드는 어두운 모드, 클로드·슬랙·카카오톡은 밝은 모드로 시작하고, 기본 테마는 쓰던 모드 그대로예요.
- **테마마다 모드 저장**: '설정 › 디스플레이'에서 바꾼 모드는 테마마다 따로 저장돼서, 다른 테마를 쓰다 오거나 기본 테마로 돌아가도 각자 쓰던 모드가 유지돼요.
- **쓰던 모드 유지**: 이미 테마를 쓰고 있던 기기는 업데이트해도 지금 모드가 바뀌지 않고, 다른 테마를 고를 때부터 모드가 함께 바뀌어요.

## 그 밖의 개선
- **장기 기억 분량 표시**: 채팅의 장기 기억에서 분량 막대 위에 지금 분량과 최대 분량이 몇 토큰인지 함께 보여요.
- **다음 정리까지 남은 분량**: 장기 기억에서 실제보다 적게 보일 수 있던 '다음 정리까지' 남은 분량이 맞게 표시돼요.
- **장기 기억 설정 이름**: 장기 기억 설정의 이름이 분량 막대와 같아져서 '기록 최대 분량'은 '기록', '한 번에 정리할 분량'은 '정리 대기 중인 대화'로 보여요.`,
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
