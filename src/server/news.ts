import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.12',
  title: '빈 홈 화면과 손님 모드 안내를 정리하고, 첫 페이지 다시 보기와 가이드를 추가했어요',
  text: `- 홈 화면('비어 있어요' 또는 '어디서 이어 갈까요?')에서 '새 연결'(연결이 있으면 '새 채팅')과 'Risu에서 이사'를 위쪽 큰 카드로 나란히 먼저 보여 주고, '봇 가져오기', '링크로 가져오기', '새 캐릭터', '연결'은 아래쪽 작은 카드 열로 배치했어요. 카드로 있던 '튜토리얼 보기'는 홈 화면 제목 옆 버튼으로 옮겼어요.
- 손님 모드일 때 홈 화면 위쪽에 크게 나오던 '손님 모드' 안내 카드를 홈 화면 맨 아래 한 줄('만든 내용은 이 브라우저에만 저장돼요.')로 줄였어요. '손님 모드의 제한'은 안내 줄의 ⓘ 버튼이나 설정 › 계정에서 볼 수 있고, '계정 만들기'와 '로그인' 버튼도 안내 줄에 함께 있어요.
- 봇이나 모듈을 가져올 때 '가져올까요?' 창에서 이름이 겹치거나 이전 버전이 있을 때 고르는 선택지를 버튼 줄에서 라디오 목록으로 바꾸고 문구를 분명하게 고쳤어요. 같은 이름의 캐릭터가 있을 때는 '새 캐릭터로 추가'와 '기존 캐릭터에 이미지만 넣기' 중에서, 이전 버전 모듈이 있을 때는 '새 버전으로 바꾸기'와 '둘 다 유지' 중에서 선택해요.
- 처음 방문한 분이 밤의 숲을 걸으며 숲지기 캐릭터 '아린'과 예시 대화('이런 대화를 나눠요')를 해 보고, 'API 키는 여기서' 안내를 거쳐 '지금 연결'에서 'API 키 붙여 넣기', '모델 선택', '대화하기' 순서로 '아린'과 바로 대화해 볼 수 있는 첫 페이지가 생겼어요. 이미 앱을 쓰는 분도 설정 › 계정의 '첫 페이지 다시 보기'에서 열어 체험해 볼 수 있으며, 여기서는 입력한 키와 대화를 저장하지 않고('여기서는 키와 대화를 저장하지 않아요.') '앱으로 돌아가기'로 원래 화면으로 돌아와요. 설정 › 계정 아래쪽과 첫 페이지에는 '헤이젤 가이드'('API 키 연결하고 대화 시작하는 법', 'RisuAI·포켓리스 백업 옮기는 법') 링크도 추가됐어요.
- 첫 페이지가 추가되면서 '개인정보 처리방침'에 '첫 페이지 단계별 방문자 수' 항목이 새로 들어갔어요(시행일: 2026년 11월 3일). 첫 페이지를 열 때, 예시 대화와 체험 구역까지 내려갈 때, API 키를 넣을 때, 앱으로 들어갈 때 브라우저가 어느 단계인지만 서버로 보내며, 입력한 API 키와 대화 내용은 보내지 않아요. 서버는 접속 주소를 하루 동안만 유효한 키로 해시해 같은 날 같은 단계를 한 번만 세고 한국 시간으로 하루가 끝나면 키와 해시를 삭제해 일별·단계별 수만 남기며, '첫 페이지 다시 보기'는 집계하지 않아요.`,
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
