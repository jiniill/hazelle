import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.8.6',
  title: '캐시가 새는 곳을 한눈에 볼 수 있어요',
  text: `## 캐시 점검 화면 개편

- **다음 전송 막대**: 채팅 메뉴 › 점검 › 캐시에서 지난 전송 아래에 다음 전송을 두고 캐시에서 읽음, 다시 보냄, 새로 보냄 비중을 보여 줘요.
- **최근 응답 흐름**: 최근 응답을 한 줄로 이어서 캐시 깨짐과 제공자가 놓침을 표시해요.
- **새는 곳 목록**: 새는 곳 목록에서 캐시가 깨진 항목마다 원인 태그, 다시 보내는 토큰 수, 최근 반복 횟수를 함께 보여 줘요.

## 새로 짚어 주는 원인

- **위치 밀림**: 대화 뒤에 둔 프롬프트 블록이 매 턴 뒤로 밀려 캐시가 깨지는 경우를 짚어 줘요.
- **값 바뀜**: 봇 스크립트가 태그 값을 바꾼 경우 바꾼 곳이 봇 스크립트라고 알려 줘요.
- **스크립트 수정**: 봇 스크립트가 보내기 직전에 메시지를 바꾼 경우를 따로 구분해 보여 줘요.
- **제공자가 캐시를 놓침**: 요청은 그대로인데 제공자가 캐시를 읽지 않은 경우를 따로 알려 줘요.

## 캐시 보호

- **효과 비교와 적용**: 설정 › 실험실 › 캐시 보호를 켜면 지금과 바꾸면의 캐시 비율과 절약 금액을 확인하고 버튼 하나로 적용하거나 되돌리기로 취소할 수 있어요.
- **지원하는 수정**: 대화 앞으로 옮기기, 위치를 정하는 프롬프트 토글 바꾸기, 매 턴 내용을 다르게 바꾸는 정규식 끄기를 실제로 아낄 수 있을 때만 제안해요.

## 그 밖의 개선

- **보내기 버튼 옆 캐시 비율**: 보내기 버튼 옆 캐시 남은 시간과 함께 다음 전송의 캐시 읽음 비율을 작은 막대와 퍼센트로 보여 줘요.

## 다음으로 준비하고 있어요

- **전체 채팅 캐시 분석**: 채팅마다 따로 보는 걸 넘어 계정의 모든 채팅에서 프롬프트, 캐릭터, 연결별로 캐시가 자주 깨지는 곳을 살펴볼 수 있어요.
- **캐시 손실 확인**: 캐시가 깨져 손실이 얼마나 되는지도 함께 확인할 수 있어요.`,
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
