import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.31',
  title: '캐릭터별 디스플레이와 배경 설정을 추가했어요',
  text: `## 캐릭터별 디스플레이
- **디스플레이 프리셋 지정**: 캐릭터 편집의 **표시**에서 프리셋을 선택해 그 캐릭터의 채팅에만 색과 글꼴을 적용할 수 있어요.
- **이 캐릭터에 고정**: 채팅의 **읽기 설정**에서 프리셋을 선택해 켜면 색과 글꼴을 그 캐릭터의 채팅에만 적용해요.

## 캐릭터 배경 이미지
- **배경 이미지**: 캐릭터 편집의 **표시**에서 채팅 배경 이미지를 추가·변경하고 켜고 끌 수 있어요.
- **배경 가림·배경 흐림**: 글자가 잘 보이도록 배경 이미지 위에 채팅 배경색을 덮는 정도와 흐림 정도를 조절할 수 있어요.

## 배경 HTML 편집
- **캐릭터 배경 HTML**: 캐릭터 편집의 **표시**에서 채팅 화면 뒤에 표시되는 배경 HTML과 메시지 스타일을 편집할 수 있어요.
- **모듈 배경 HTML**: **설정 › 모듈**에서 각 모듈의 배경 HTML을 작성하고 편집할 수 있어요.

## 그 밖의 개선
- **봇 스타일과 배경 이미지 분리**: 캐릭터의 **봇 스타일**을 꺼도 채팅 배경 이미지는 사라지지 않고 표시돼요.
- **에셋·배경 실패 안내**: 이미지나 영상을 추가하거나 바꾸지 못했을 때 에셋과 배경 중 무엇이 실패했는지 구분해 알려 줘요.`,
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
