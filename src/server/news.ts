import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.8.4',
  title: '플러그인에 삽화를 맡길 수 있어요',
  text: `## 플러그인

- **삽화 맡기기**: //@uses illustrate를 선언한 플러그인이 메시지 삽화를 대신 그려 배치하고, '다시 그리기'를 누르면 같은 플러그인에 다시 요청해요.
- **이미지 첨부와 프롬프트 캐시**: 플러그인에서 chat.model로 모델에 이미지를 함께 보내고 프롬프트 캐시 지점도 지정할 수 있어요.
- **캐릭터별 구도와 문단 배치**: chat.draw로 그림 속 캐릭터마다 프롬프트와 위치를 정하고, chat.picture로 원하는 문단에 그림을 넣거나 슬롯별로 바꿀 수 있어요.
- **캐릭터 정보와 삽화 프로필 접근**: chat.cast와 chat.portraits로 참여 캐릭터의 카드·에셋·삽화 프로필을 읽고, 사용자 동의를 거쳐 chat.editPortraits로 삽화 프로필을 수정할 수 있어요.

## 모델 연결

- **채팅 화면에서 바로 연결**: 모델이 연결되지 않은 계정의 채팅에서 '모델 연결' 버튼을 누르면, 채팅을 나가지 않고도 API 키를 입력하거나 OpenRouter로 로그인해 첫 모델을 고를 수 있어요.

## 서버 작업 예고

- **작업 전 미리 안내**: 예정된 서버 작업이 있으면 앱을 열어 둔 상태에서 시작 시각과 예상 소요 시간을 미리 볼 수 있어요.
- **작업 중 안내**: 작업 중 연결에 실패하면 네트워크 확인 안내 대신 서버 작업 중이라는 내용과 예상 종료 시각을 보여 줘요.

## 그 밖의 개선

- **이전 버전 탭 복원 수정**: 브라우저의 뒤로·앞으로 가기로 이전 버전 탭이 돌아올 때 오류 대신 '새 버전이 나왔어요' 안내가 먼저 떠요.
- **장기 기억 읽기 개선**: 일부 모델이 장기 기억을 조금 어긋난 형식으로 보내도 실패하지 않고 읽어 와요.`,
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
