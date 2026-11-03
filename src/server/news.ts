import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.15',
  title: '캐릭터별 채팅 폴더와 전체 채팅 검색, 여러 채팅 선택·삭제를 추가했어요',
  text: `## 캐릭터별 채팅 폴더
- **폴더 만들기·관리**: 사이드바의 캐릭터별 채팅 목록(및 '캐릭터 없이') 상단 **새 폴더** 버튼으로 폴더를 만들 수 있어요. 폴더의 **⋯** 메뉴나 우클릭으로 **이름 바꾸기**, **새 하위 폴더**(최대 3단계), **폴더 삭제**를 쓸 수 있어요.
- **폴더 삭제**: 하위 폴더도 함께 삭제되고, 안의 채팅은 한 단계 위(상위 폴더 또는 폴더 밖)로 옮겨져요(**되돌리기**로 복원 가능).
- **채팅 옮기기**: 채팅 화면 우측 상단 **⋯** 메뉴의 **폴더로 옮기기**(폴더가 있을 때 표시, 꺼낼 때는 **폴더에서 빼기**)를 쓰거나, 넓은 화면에서 채팅을 폴더나 다른 채팅 위로 끌어다 놓으면 같은 위치로 옮겨져요(폴더 밖 채팅 위에 놓으면 폴더에서 나와요).
- **검색·분기·가져오기**: 캐릭터 안의 **이 목록에서 검색**은 모든 폴더 안의 채팅까지 찾고 폴더 경로를 함께 보여 줘요. **여기서 분기**로 만든 채팅이나 같은 캐릭터에 **채팅 가져오기**로 다시 넣은 **채팅 파일**은 원래 폴더 위치를 유지해요(다른 캐릭터에 가져오면 폴더 밖에 놓여요).
- **Risu에서 이사**: 캐릭터를 옮길 때 Risu의 채팅 폴더 구조와 채팅별 폴더 위치도 함께 가져와요(빈 이름은 **이름 없는 폴더**로 표시). 다만 Risu 폴더의 색상·접힘 상태는 가져오지 않고, 개별 **Risu 채팅 파일**을 가져오거나 내보낼 때는 폴더 정보가 포함되지 않으며, 업데이트 전에 이사한 캐릭터에는 소급 적용되지 않아요.

## 채팅 목록 우클릭과 여러 채팅 선택
- **우클릭 메뉴**: 사이드바 채팅 목록에서 우클릭으로 **이름 바꾸기**, **폴더로 옮기기**, **삭제**를 쓸 수 있어요.
- **여러 채팅 선택**: 채팅 목록 상단의 **선택** 버튼을 누르거나 \`Ctrl\` 클릭(개별 추가·해제)·\`Shift\` 클릭(범위 선택)으로 여러 채팅을 선택할 수 있어요.
- **한꺼번에 옮기기·삭제**: 목록 아래 바에서 한꺼번에 **폴더로 옮기기**나 **삭제**를 실행하거나, 선택한 채팅을 끌어 한꺼번에 옮길 수 있어요. 삭제한 채팅은 알림의 **되돌리기** 한 번으로 모두 복원하거나 7일 안에 **휴지통**에서 복원할 수 있어요.

## 전체 채팅 검색
- **열기**: 왼쪽 사이드바(휴대폰은 캐릭터 목록 상단) **캐릭터 둘러보기** 아래의 **채팅 검색** 버튼이나 \`Ctrl+K\`로 모든 캐릭터와 **캐릭터 없이**의 채팅을 한곳에서 검색할 수 있어요.
- **본문까지 검색**: 검색어를 입력하면 제목·마지막 메시지 미리보기가 일치하는 채팅을 보여 주고, 입력을 멈추면 기기에서 메시지 본문(현재 선택된 응답 버전과 번역문)까지 찾아 일치하는 대목과 캐릭터·폴더·채팅 경로를 함께 보여 줘요.
- **이름 치환**: 본문에 쓰인 \`{{char}}\`·\`{{user}}\`·\`<char>\`·\`<user>\`·\`<bot>\`은 해당 채팅의 캐릭터 **부르는 이름**(없으면 캐릭터 이름)과 **페르소나** 이름으로 읽어서 찾아요.
- **메시지로 이동**: 본문이 일치한 결과를 누르면 해당 메시지 위치로 이동하고 검색어가 채워진 **채팅 내 검색**이 열려요(**뒤로**를 누르면 검색 결과로 돌아와요).
- **검색 제외**: **휴지통**의 캐릭터·채팅과 선택되지 않은 다른 응답 버전은 제외돼요. 봇의 **스크립트**(**화면** **정규식**, Lua 등)나 다른 **명령어**(CBS)가 화면 표시 시점에 바꾸거나 만드는 내용은 저장된 원문 기준으로 검색돼요.

## 그 밖의 개선
- **'장기 기억' 오류 안내 구체화**: **장기 기억** 패널에서 기억 정리나 **챕터** 생성 오류가 났을 때, 요약 누락·기록 범위 불일치·마지막 메시지 미정리 또는 빠지거나 형식이 맞지 않는 항목 이름을 구체적으로 알려 줘요.
- **내 메시지 말풍선 여백 정리**: 봇 전용 CSS의 문단 여백이 내 메시지 말풍선 위아래 끝에 빈 공간으로 덧붙던 문제를 고쳐, 문단 사이 간격만 남도록 정리했어요.`,
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
