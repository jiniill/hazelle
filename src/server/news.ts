import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.8.5',
  title: '번역 모델을 직접 고를 수 있어요',
  text: `## 번역 모델 선택

- **번역기에서 바로 선택**: 도구 › 번역기 화면에서 번역 모델을 직접 고를 수 있어요.
- **보조 모델 유지**: 따로 고르지 않으면 설정 › 모델의 보조 모델을 그대로 써요.

## 그 밖의 개선

- **서버 작업 안내**: 서버 작업이 끝난 뒤 계정을 다시 열 때 작업이 끝났다고 정확히 알려 줘요.
- **기기 저장 속도**: 채팅이 아주 많은 계정에서도 바뀐 내용이 기기에 더 빨리 저장돼요.
- **긴 프롬프트 편집**: 긴 프롬프트를 편집할 때 입력이 더 부드러워졌어요.
- **메시지 입력창**: 메시지를 쓰면서 입력창이 커지거나 줄어들 때 채팅 화면이 덜 버벅여요.`,
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
