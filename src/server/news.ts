import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.8.2',
  title: '판단 모델을 따로 고를 수 있어요',
  text: `## 판단 모델

- **전용 역할 추가**: 설정 › 모델에서 글을 쓰지 않고 예·아니오, 고르기, 점수만 답하는 판단 모델을 고를 수 있어요.
- **플러그인 판단 처리**: 플러그인이 판단을 요청할 때 이 모델을 쓰고, 고르지 않으면 실패로 알려 줘요.
- **모델 화면 정리**: 대화 모델과 보조 모델은 카드로, 임베딩 모델과 판단 모델은 아래 '다른 공용 모델' 묶음에 한 줄씩 정리했어요.

## 플러그인 제작

- **한 번에 판단 묻기**: \`//@uses decide\`와 \`chat.decide\`로 판단 모델에게 예·아니오, 여러 개 중 고르기, 점수를 한 번에 묻고 확률까지 받을 수 있어요.
- **플러그인별 모델 지정**: \`//@model\`로 모델 자리를 선언하면 플러그인 화면에 자리마다 줄이 생겨 사용자가 모델을 고를 수 있어요.
- **그림 생성**: \`//@uses draw\`를 선언하면 \`chat.draw\`가 삽화의 이미지 모델로 그림을 만들고, 유료 생성은 삽화 설정의 '유료 생성 시 확인 생략'이 꺼져 있으면 건너뛰었다고 알려 줘요.

## 속도 개선

- **무거운 채팅 속도 개선**: 메시지와 봇 스크립트가 많은 채팅에서 응답을 받거나 메시지를 표시할 때 덜 버벅여요.
- **부드러운 실시간 번역**: 번역이 흘러나오는 동안 채팅 전체가 아니라 해당 메시지만 다시 그려 화면이 부드러워졌어요.
- **더 빠른 첫 화면**: 앱을 처음 열 때 불러오는 양이 줄어 첫 화면이 더 빨리 떠요.
- **채팅이 많아도 빠르게**: 채팅이 아주 많은 계정에서 채팅 검색과 삭제 전 확인, 백업·카드 파일 만들고 읽기가 빨라졌어요.
- **빠른 플러그인 표시**: 플러그인이 채팅 화면에 그려 주는 요소가 더 빨리 나타나요.

## 그 밖의 개선

- **봇 스크립트 멈춤 수정**: 느린 기기에서 무거운 봇 스크립트가 돌고 있는데도 '봇 스크립트가 끝나지 않아서 멈췄어요'라며 멈추던 문제를 고쳤어요.
- **Proton Drive 오류 구분**: Proton Drive 공유 링크로 가져올 때 링크가 잘린 경우와 비밀번호가 틀린 경우를 구분해서 알려 줘요.`,
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
