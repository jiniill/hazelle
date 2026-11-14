import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.0',
  title: '앱 모양을 바꾸는 테마가 생겼어요',
  text: `## 테마
- **테마 고르기**: '설정 › 테마'에서 '기본'과 새로 생긴 네 가지 테마 중 하나를 고르면 앱 전체 모양이 바로 바뀌고 기기마다 따로 저장돼요.
- **클로드**: 얼굴과 이름 없이 글만 이어지고 내 말은 오른쪽 상자에 담기며, 한 줄 입력창 아래에서 도구를 쓰고 모델을 고를 수 있어요.
- **디스코드**: 메시지마다 얼굴·이름·시간이 붙고, 채팅 목록은 # 채널처럼 보여요.
- **슬랙**: 왼쪽 메뉴에 이름이 붙고, 입력창 도구가 글 쓰는 칸 위에 놓여요.
- **카카오톡**: 대화를 말풍선으로 주고받고 내 말은 노란 말풍선으로 보이며, 응답을 문단마다 말풍선으로 나누는 기능은 '말풍선 나누기' 스위치로 끌 수 있어요.

## 디스플레이와 읽기 폭
- **테마마다 따로 저장**: 새 테마 네 가지는 글꼴·글자 크기·줄 간격·읽기 폭에 저마다 시작값이 있고, 그 테마를 쓰는 동안 바꾼 값은 테마마다 따로 저장돼요.
- **색과 밝은/어두운 모드**: '설정 › 디스플레이'의 배경·글자·대사·강조 색과 밝은/어두운 모드는 어느 테마에서나 그대로 쓸 수 있어요.
- **읽기 폭 '가득'**: 읽기 폭에 '가득' 단계가 새로 생겨 모든 테마에서 글 폭 제한 없이 화면 폭을 다 쓸 수 있어요.
- **이름 변경**: 읽기 폭과 줄 간격의 '매우 넓게'가 '더 넓게'로 바뀌었어요.

## 고친 문제
- **채팅 불러오기**: 창 크기를 휴대폰 너비 안팎으로 바꿀 때 열려 있던 채팅이 '채팅을 불러오는 중'에서 멈추던 문제를 고쳤어요.
- **입력창 도구 메뉴**: 입력창 도구 메뉴를 연 채 위로 스크롤해 입력창이 접히면 메뉴가 열린 채로 안 보이던 문제를 고쳐 이제 그대로 보여요.

## 가이드
- **새 가이드**: '채팅 화면 테마 바꾸는 법' 가이드가 새로 생겼어요.`,
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
