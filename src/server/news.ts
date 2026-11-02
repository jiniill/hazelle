import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.10',
  title: '링크와 zip 파일로 봇을 가져오고, 고정한 토글을 모아 놓거나 펼쳐 놓을 수 있어요',
  text: `- 홈 화면이나 사이드바 '추가' 메뉴의 '링크로 가져오기'에서 '봇 링크' 칸에 Realm 봇 링크, Proton Drive 공개 링크, 파일 다운로드 링크(https)를 붙여 넣어 '가져오기'를 누르면 파일을 받아 '가져올까요?' 미리보기 창을 열어요. 비밀번호가 걸린 Proton Drive 링크는 '링크 비밀번호' 칸이 나타나며 입력한 비밀번호는 이 브라우저에서만 쓰이고, 폴더 링크는 폴더 안의 가져올 수 있는 파일들을 함께 가져와요. Realm 외의 링크는 하루 사용량에 포함되며, Proton Drive 링크는 계정이 있어야 가져올 수 있어요.
- '봇 가져오기'나 화면에 파일을 끌어다 놓을 때, 또는 '링크로 가져오기'로 받은 파일이 zip 압축 파일일 때 압축을 풀지 않고도 가져올 수 있어요. 압축 파일 안의 캐릭터 카드, 모듈, 프롬프트, 플러그인, 채팅 파일을 찾아 '가져올까요?' 창에 한 줄씩 보여 주며, 확장자만 .zip으로 바뀐 .charx 파일은 캐릭터 카드 하나로 읽어요. 카드가 들어 있지 않은 일반 이미지나 문서처럼 가져올 수 없는 파일은 '가져오지 않은 파일 N개'로 표시하고, 비밀번호가 걸린 압축 파일은 압축을 풀고 가져오도록 안내해요.
- '토글' 패널에서 '입력창에 고정'한 토글이 있을 때, 채팅 입력창 아래 도구 줄 끝의 ⋯ 버튼을 눌러 '입력창에 둘 도구' 아래 '고정한 토글'에서 '모아 놓기'와 '펼쳐 놓기' 중 선택할 수 있어요. '모아 놓기'(기본)는 '토글 N개' 버튼 하나로 묶어 '고정한 토글' 패널을 열고, '펼쳐 놓기'는 고정한 토글을 입력창에 버튼마다 펼쳐 놓아 스위치 토글('켜짐'·'꺼짐')은 누르면 켜고 꺼지며 선택지 토글은 메뉴를 열어 바꿔요. 선택한 방식은 계정에 저장돼 모든 채팅에 적용돼요.`,
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
