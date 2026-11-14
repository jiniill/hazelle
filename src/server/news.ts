import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.35',
  title: '원하는 채팅 즐겨찾기',
  text: `## 채팅 즐겨찾기
- **즐겨찾기**: 채팅 헤더의 별 버튼이나 ⋯ 메뉴에서 즐겨찾기를 켜면 채팅 목록과 분기 지도에 별이 표시돼요.
- **모아 보기**: 즐겨찾기한 채팅이 있으면 채팅 목록 검색창 아래에 '즐겨찾기' 탭이 생겨 모아 볼 수 있어요.

## 게시판
- **글 검색**: 목록 위의 '글 검색'에서 제목·본문으로 글을 찾고, 분류 탭을 고르지 않으면 소식 글도 나와요.
- **조회수**: 글 화면에서 조회수를 볼 수 있어요.
- **작성·수정 시각**: 글 화면의 글과 댓글에 '몇 분 전' 대신 날짜와 시각이 표시되고, 수정한 글은 수정 시각도 보여요.

## 채팅 화면 조작
- **입력창 접기**: '설정 › 조작'에서 켜 두면 쓰던 글이 있어도 위로 스크롤할 때 첫 줄과 …만 남기고 접히며, 누르거나 맨 아래로 내려가면 펼쳐져요.
- **메시지 도구 따라오기**: 스위치를 끄면 긴 메시지를 읽는 동안 복사·다시 생성 같은 버튼 줄이 입력창 위에 따라오지 않아요.

## Risu 플러그인과 모듈
- **Risu 플러그인 호환**: 채팅 변수를 다루거나 메시지를 삭제하고 채팅별 데이터를 보관하는 Risu 플러그인을 쓸 수 있어요.
- **보조 모델 고르기**: 모듈·플러그인 편집 화면의 '보조 모델'에서 쓸 모델을 모듈마다 고를 수 있어요.
- **보조 모델 고정**: 지정한 보조 모델을 쓸 수 없으면 다른 모델로 대신하지 않고 멈추며 알려 줘요.

## 그 밖의 개선
- **플러그인 가져오기**: Risu 플러그인을 가져올 때 XML 네임스페이스 주소를 외부 연결로 잘못 세지 않아요.
- **실행 기록**: 점검의 실행 기록에서 플러그인이 내용을 실제로 바꿨을 때만 '변경됨'으로 표시돼요.`,
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
