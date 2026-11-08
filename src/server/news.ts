import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.24',
  title: '큰 계정의 새로고침과 화면 불러오기가 빨라졌어요',
  text: `## 새로고침과 화면 불러오기
- **큰 계정 새로고침 속도**: 캐릭터와 채팅이 많은 계정에서도 화면을 새로고침할 때 저장된 데이터를 더 빠르게 불러와요.
- **화면 열기 단계 단축**: 한 번 열었던 기기에서 다시 접속하거나 새로고침하면 **계정 확인** 중에 다음 화면을 함께 준비해 대기 단계 하나를 건너뛰고 열려요.

## 요청·응답 원문 보관
- **채팅 이동·새로고침 뒤에도 유지**: 다른 채팅으로 이동하거나 화면을 새로고침해도 **응답 정보**에서 최근 **요청 원문**과 **응답 원문**을 다시 볼 수 있어요.
- **보낸 기기에만 암호화 보관**: 원문 기록은 요청을 보낸 기기에만 암호화해 저장하고 서버로 보내지 않으며, **로그아웃**하면 함께 삭제돼요.

## 드래그한 문단 수정과 삭제
- **선택한 문단 삭제**: 메시지에서 문단을 드래그해 선택하면 뜨는 **삭제** 버튼을 누르거나 \`Delete\`·\`Backspace\` 키를 눌러 선택한 문단을 삭제할 수 있어요.
- **타이핑으로 수정 시작**: 문단을 드래그해 선택한 상태에서 글자를 입력하면 드래그를 시작한 위치에 글자가 들어가며 수정 창이 열려요.

## 가져온 파일 원본 보관
- **원본 파일 함께 보관**: 캐릭터·모듈·프롬프트 파일을 가져올 때 **원본 보관 중** 단계에서 원본 파일을 함께 보관하며, 에셋이나 프로필 이미지와 겹치는 데이터는 중복으로 올리지 않아요.
- **보관 실패 시 안내**: 용량 한도 등으로 보관하지 못한 원본 파일 조각이 있어도 가져온 항목은 저장되고, 빠진 조각은 **가져오지 못한 항목**에 표시돼요.

## 그 밖의 개선
- **원문 함께 보기 문단 정렬**: **원문 함께 보기**에서 번역문이 한 문단을 여러 문단으로 나누거나 대사와 서술의 순서를 바꿔 합쳐도 원문이 제자리에 맞춰 표시돼요.`,
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
