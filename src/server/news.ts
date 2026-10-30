import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.2',
  title: '휴대폰과 태블릿에서 Enter가 줄을 바꾸고, 설정 검색과 RisuAI 호환이 개선됐어요',
  text: [
    "- 휴대폰과 태블릿 같은 터치 기기에서는 채팅의 '메시지' 입력창에서 Enter를 누르면 줄이 바뀌고, '보내기' 버튼을 눌러 메시지를 보내요. Enter로 메시지를 보내고 싶다면 설정 › 조작 › '입력창'의 'Enter로 보내기'를 켜면 돼요.",
    "- 메뉴·대화상자·이미지 보기나 화면을 덮는 사이드 패널을 연 채 기기나 브라우저의 뒤로 가기를 누르면 페이지에서 나가지 않고 열려 있는 창부터 닫혀요. 터치 화면에서 검색칸이 있는 메뉴를 열 때 화상 키보드가 자동으로 올라오지 않고, iOS에서 입력칸을 눌렀을 때 화면이 확대되지 않으며, 스위치와 ⓘ 도움말 버튼의 누름 영역이 넓어지고 설정 줄의 이름을 눌러도 스위치를 켜고 끌 수 있어요.",
    "- 좁은 화면에서 메시지를 수정할 때는 하단 입력창이 한 줄로 접혀요. 휴대폰 캐릭터 목록 상단의 추가 버튼은 '추가' 메뉴('봇 가져오기'·'새 캐릭터'·'Risu에서 이사'·'캐릭터 없이 새 채팅')와 '캐릭터 둘러보기'로 정리됐고, 캐릭터의 채팅 목록에서는 '새 채팅'이 앞에 놓이고 '채팅 가져오기'는 옆의 아이콘 버튼으로 바뀌었어요.",
    "- 설정의 '설정 검색'에서 화면에 있는 설정 항목 이름과 자주 찾는 말('캐싱'·'폰트'·'다크 모드'·'라이트 모드'·'메모리'·'temperature'·'최대 토큰'·'API 키'·'휴지통' 등)로 검색할 수 있고, 검색 결과를 선택하면 '세부 설정' 같은 접힌 구간을 펼쳐 해당 줄로 이동해 강조해 줘요. 설정 사이드바는 목록 전체가 하나로 스크롤되며 현재 열려 있는 항목이 보이게 맞춰지고, 설정 › 프롬프트에서는 '기본 프롬프트'가 기본으로 접혀 있고 넓은 화면에서는 '프롬프트 검색'과 '정렬'('이름'·'최근 사용')이 한 줄에 놓여요. 설정 › 모델과 설정 › API 연결에서 값을 정하지 않은 '모델 설정'은 '모델 원래 값'으로 표시되고, 설정 › 계정 › 사용량의 '날짜별'·'월별' 막대그래프에서는 막대 사이 빈 곳을 눌러도 가장 가까운 날이 선택돼요.",
    "- RisuAI 프리셋을 가져올 때 '캐릭터 설명'·'페르소나'·'작가의 노트'·'장기 기억' 블록에 남아 있던 예전 역할 값 때문에 '시스템' 대신 'AI'나 '사용자' 역할로 들어오던 문제를 고쳤어요. 이번 업데이트 전에 RisuAI에서 가져온 프롬프트는 설정 › 프롬프트 › 'Risu 프리셋 가져오기'(또는 'Risu에서 이사')로 다시 가져오면 고쳐져요. 또한 RisuAI에서 프리셋을 저장한 적 없는 백업 파일로 'Risu에서 이사'를 할 때도 쓰던 프롬프트 템플릿이 함께 이전되고, RisuAI의 시작 전 설문을 쓰는 카드를 가져오면 '가져오지 못한 항목'에 '시작 전 설문'으로 표시돼요.",
    "- 봇의 '정규식'이 만든 <Thoughts>·<think>·<thinking> 추론 블록은 본문과 다음 프롬프트 전송에서 빼고 메시지 메뉴(⋯) › '응답 정보'의 '추론'에 모아 보여 줘요(본문에 두려면 캐릭터 편집 › '표시'에서 '추론을 본문에 표시'를 켜면 돼요). 명령어(CBS)에서 {{#each}}가 각 줄의 앞뒤 공백을 정리해 에셋 이미지를 고르는 구문이 정상 작동하고 {{? ...}}·{{calc::...}}에서 ??와 삼항 연산자(? :)를 계산하며, 봇 스크립트가 쓴 <risu-style>이 스타일로 적용되고, 스크립트를 부르는 라벨(risu-trigger·risu-btn)을 눌렀을 때 체크박스·라디오 버튼도 함께 바뀌며, 헤이젤이 지원하지 않는 RisuAI 비동기 Lua 함수를 :await()로 호출해도 스크립트가 멈추지 않고 nil을 받아요. 내용이 비어 있는 응답('모델이 내용이 비어 있는 응답을 보냈어요.')과 OpenAI Responses 형식의 거절 응답은 빈 메시지 대신 실패로 표시하고, Gemini 모델이 받지 않는 '추론' 단계(Gemini 3.1 Pro의 '최소', Gemini 2.5의 단계 값 등)는 모델이 받는 값으로 바꿔 전송해요.",
    "- '개인정보 처리방침'이 개정되어 두 가지 집계가 추가됐어요. 계정이 없는 '손님'이 앱을 열 때·연결을 추가할 때·대화 응답을 받을 때 브라우저가 만든 손님 식별자와 어느 단계인지를 서버에 보내 일별 단계별 손님 수('손님 방문'·'손님 연결'·'손님 응답')와 손님으로 응답을 받아 본 뒤 7일 안에 계정을 만든 사람 수('손님 출신')를 세고, 손님 식별자와 단계·날짜 기록은 7일 뒤 지우며 일별 단계별 수만 식별자 없이 남아요(역할·연결 방식·모델 식별자는 보내지 않고, 손님은 '헤이젤 나우'에 들어가지 않아요). 계정이 있고 설정 › 계정 › 앱 정보의 '헤이젤 나우 집계 참여'를 켜 둔 경우, '헤이젤 나우'의 사람 수를 세는 목록에서 한 주가 끝날 때 가입한 주와 그 주에 앱을 연 주별 인원수('가입 주별 재방문')를 5명 이상일 때만 계정 식별자 없이 남겨요. 두 집계 모두 대화 내용은 세거나 읽지 않아요. 손님의 대화·캐릭터 내용은 브라우저에만 저장되고 모델 호출도 서버를 거치지 않으며, 로그인한 계정의 대화·캐릭터 내용은 브라우저에서 암호화되어 운영자가 열어 볼 수 없고 '헤이젤 나우'에는 앱을 열 때의 활성 표시와 모델을 호출할 때의 역할('대화'·'보조'·'임베딩')·연결 방식('직접 연결'·'서버 경유')·모델 식별자만 전송돼요.",
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
