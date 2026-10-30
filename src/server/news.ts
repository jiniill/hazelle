import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.1',
  title: '캐릭터·로어북·프롬프트·노트 입력 칸에 토큰 수가 표시되고, 채팅의 사이드 패널에서 Ctrl+F로 브라우저 검색을 열 수 있어요',
  text: [
    "- 캐릭터 편집의 '캐릭터'('설명'·'성격'·'상황'·'예시 대화'), '첫인사', '지시문'('시스템 프롬프트'·'대화 뒤 지시문'·'번역가의 노트'), 설정 › 페르소나의 '설명', 캐릭터·모듈의 '로어북'과 채팅의 '채팅 로어북' 항목의 '내용', 설정 › 프롬프트의 메시지 블록 '내용'과 '작가의 노트' 블록의 '기본 노트', 채팅 하단 '노트'로 여는 '작가의 노트', 설정 › 채팅 › 번역과 '번역기'의 '번역가의 노트' 칸에 내용을 입력하면 '약 N 토큰'으로 토큰 수가 표시돼요. 해당 칸에서 '크게 편집'을 열었을 때도 상단에 함께 표시돼요.",
    "- 채팅에서 '점검', '응답 정보', '장기 기억', '토글', '채팅 로어북', '북마크', '오토파일럿', '캐릭터', '프롬프트', '모듈' 같은 사이드 패널에 포커스나 마우스 포인터를 두거나 대화상자 안에서 Ctrl+F를 누르면 '채팅 내 검색' 대신 브라우저 검색이 열려요.",
    "- 설치한 헤이젤 플러그인과 같은 이름·제작자의 .js 파일을 설정 › 플러그인의 '플러그인 가져오기'나 파일 끌어다 놓기로 가져오면, '만드는 중' 목록의 초안도 가져온 파일로 바뀌고 알림의 '되돌리기'를 누르면 초안도 이전 상태로 복원돼요. 스튜디오에서 수정한 내용이 있는 초안('적용한 버전과 다름')은 수정한 내용을 유지하고, '적용'을 눌러 '적용할까요?' 창을 열면 설치된 코드가 바뀌었다는 경고를 보여 줘요.",
    "- 설정 › 플러그인 › '새 플러그인'의 '빈 파일로 시작' 옆에 'Claude Code나 Codex로 만들기' 링크가 생겼어요. Claude Code나 Codex에 붙여 넣어 플러그인을 만들게 하는 요청문과 //@ 헤더 문법, 예제 코드, 타입 검사·가져오기 방법을 안내 문서에서 볼 수 있어요.",
  ].join('\n'),
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
