import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.4',
  title: '읽는 동안 화면이 저절로 내려가요',
  text: `## 자동으로 천천히 내려가기
- **켜기와 속도**: 채팅의 읽기 설정에서 '자동으로 천천히 내려가기'를 켜면 읽는 동안 화면이 천천히 내려가고, 속도도 선택할 수 있어요.
- **누르면 멈춤**: 화면을 누르고 있으면 멈추고, 직접 스크롤하면 잠시 뒤 다시 내려가요.

## 입력란 번역
- **영어로 번역**: 캐릭터 편집기 등 입력란 옆의 번역 버튼을 누르면 내용이 영어로 바뀌어요.
- **원래 내용 복원**: 번역한 뒤 알림의 '되돌리기'를 누르면 원래 내용을 복원할 수 있어요.
- **코드 보존**: 번역할 때 {{ }} 태그 같은 코드는 바뀌지 않고 남아요.

## 모델 선택
- **통일된 메뉴**: 어디서 모델을 선택하든 같은 메뉴가 열리고, API 연결별로 묶여 보여요.
- **모델 검색**: 모델이 많으면 검색창이 나오고, ↑·↓ 키로 이동해 Enter로 첫 결과를 선택할 수 있어요.
- **짧아진 줄**: 마우스를 쓰는 화면에서 메뉴 줄이 낮아져 한 번에 더 많이 보여요.

## 장기 기억
- **응답 원문 보기**: 기억 정리나 챕터 만들기가 실패하면 '응답 원문 보기' 버튼을 눌러 모델 응답을 점검에서 볼 수 있어요.
- **한도 안내**: 기록이 한도를 넘어 일부를 보내지 않을 때 몇 개가 빠졌는지와 한도를 늘리는 곳을 알려 줘요.

## 그 밖의 개선
- **장기 기억 다시 시도**: 봇 스크립트가 끝나지 않아 정규식이 꺼진 채팅에서 장기 기억의 '다시 시도'가 실패하던 문제를 고쳤어요.
- **Risu 플러그인**: 캐릭터 내용을 다루거나 파일을 올리는 등 더 많은 Risu 플러그인을 쓸 수 있어요.`,
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
