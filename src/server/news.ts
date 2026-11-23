import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.8.0',
  title: '대화 프리셋으로 설정을 한 번에 바꿀 수 있어요',
  text: `## 대화 프리셋

- **한 번에 바꾸기**: 모델 메뉴 맨 위에서 프리셋을 고르면 대화 모델, 프롬프트, 토글, 번역 설정이 지금 채팅에 바로 적용돼요.
- **저장과 관리**: 같은 메뉴의 '대화 프리셋 저장·관리'에서 지금 채팅 설정을 이름 붙여 저장하거나 덮어쓰기, 삭제, 이름·순서 바꾸기를 할 수 있어요.
- **바로 되돌리기**: 프리셋을 바꾼 뒤 알림의 '되돌리기'를 누르면 원래 설정으로 돌아가요.
- **현재 프리셋 표시**: 지금 채팅의 설정이 프리셋과 같으면 모델 버튼에 그 프리셋 이름이 보여요.
- **토글 적용 범위**: 프롬프트 토글은 캐릭터에 저장되는 값이라 같은 캐릭터의 다른 채팅에도 같이 바뀌어요.

## 더 가벼워진 채팅 화면

- **부드러운 스크롤**: 메시지가 많은 채팅을 스크롤할 때 덜 버벅여요.
- **이미지 가리기**: '이미지 가리기'를 켜 두면 눌러서 연 이미지만 불러와요.
- **사진 채팅 전송**: 사진을 보낸 채팅에서 다음 메시지를 보낼 때 전송 준비가 빨라졌어요.

## 플러그인 제작

- **테스트 화면**: 설치한 플러그인의 ⋯ 메뉴에서 채팅과 실행 시점을 골라 채팅과 저장소를 바꾸지 않고 테스트해 볼 수 있어요.
- **호출 기록**: 테스트 결과의 '호출 기록'에서 플러그인이 앱에 보낸 요청과 받은 답, \`console\` 출력을 순서대로 볼 수 있어요.
- **늘어난 테스트 시점**: 요청을 보내기 전, 응답을 저장하기 전, 메시지를 표시할 때 등 테스트할 수 있는 실행 시점이 늘었어요.
- **진행 상태 알리기**: \`chat.progress\`로 응답을 기다리는 동안 지금 하는 일을 한 줄로 알릴 수 있어요.
- **앱 테마 색 쓰기**: \`hazelle.page.colors\`로 플러그인 페이지에서 앱 테마의 색을 받아 쓸 수 있어요.
- **페이지 바로 열기**: 입력창 버튼에 페이지만 있는 플러그인은 버튼을 누르면 페이지가 바로 열려요.

## 그 밖의 개선

- **디스플레이 프리셋 순서**: 디스플레이 프리셋의 ⋯ 메뉴에서 순서를 바꿀 수 있어요.
- **삽화 프로필 저장 문제**: 삽화 프로필을 모두 삭제한 뒤 새로 만들거나 가져온 프로필과 그린 삽화가 저장되지 않던 문제를 고쳤어요.`,
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
