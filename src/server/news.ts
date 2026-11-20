import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.8',
  title: '응답이 번지듯 나타나는 효과를 추가했어요',
  text: `## 응답 부드럽게 표시

- **부드러운 응답 표시**: 응답이 생성될 때 덩어리째 뜨지 않고 끝부분이 부드러운 그라데이션으로 번지듯 나타나요.
- **기존 계정 제안 창**: 업데이트 전 계정은 꺼진 상태로 시작하고, 채팅에 들어가면 미리보기와 함께 '써볼게요'나 '괜찮아요'를 선택하는 창이 한 번 떠요.
- **설정과 기본값**: 새 계정은 켜진 상태로 시작하고, 어떤 선택을 했든 설정 › 디스플레이 › 채팅 화면의 '응답 부드럽게 표시'에서 바꿀 수 있어요.
- **새 기능 제안 방식**: 앞으로 스위치가 있는 기능이 추가될 때도 계정마다 한 번씩 써 볼지 묻는 창으로 안내해요.

## 더 쉬워진 API 연결

- **OpenRouter 로그인 연결**: API 연결 추가 화면에서 OpenRouter 계정으로 로그인하면 키를 붙여 넣지 않아도 연결돼요.
- **무료 모델 우선 표시**: 모델 목록 앞쪽에 무료 모델이 표시돼 선택하기 편해요.

## 기본 캐릭터 아린

- **새 계정 기본 캐릭터**: 새 계정을 만들면 기본 캐릭터 아린이 추가돼 캐릭터를 만들지 않아도 대화할 수 있어요.

## 그 밖의 개선

- **체험 대화 남은 무료 요청**: 첫 방문 체험 대화에서 오늘 남은 무료 요청 횟수를 볼 수 있어요.
- **첫인사 선택 유지**: 캐릭터의 첫인사 순서를 바꾼 뒤에도 새 채팅에서 선택한 첫인사가 유지돼요.
- **스페이스 키 입력**: 링크로 동작하는 목록 항목과 카드도 스페이스 키로 누를 수 있어요.
- **손님 데이터 올리기**: 손님 데이터를 계정에 올릴 때 대화하지 않은 기본 캐릭터는 제외돼요.
- **응답 태그 표시**: 응답이 생성되는 동안 덜 도착한 태그가 원문 텍스트로 보이지 않아요.
- **보내기 버튼 색상**: 보내기 버튼에 마우스를 올렸을 때 색상이 현재 테마를 따라가요.`,
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
