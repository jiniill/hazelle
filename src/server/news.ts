import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.0',
  title: '앱 안에서 헤이젤 플러그인을 만들 수 있고, 대화 모델이 플러그인 도구를 호출하며 응답해요',
  text: [
    "- 응답 아래 '사용량 표시' 줄과 눌렀을 때 펼쳐지는 상세 정보('비용', '입력'·'출력' 토큰, '캐시', '걸린 시간')가 '이어 쓰기'와 플러그인 '모델 도구' 호출까지 합산해 응답 전체 기준으로 보여 줘요. 호출별 내역은 메시지 메뉴(⋯) › '응답 정보'의 '이전 호출'에서 볼 수 있어요.",
    "- 첫 메시지를 보내기 전인 '새 채팅'에서도 채팅 메뉴(⋯) › '기능'을 열어 '번역', '삽화', '장기 기억', '마스코트' 같은 기능을 켜거나 끌 수 있고, 선택한 내용이 첫 메시지를 보낸 뒤에도 유지돼요.",
    "- 설정 › 모듈에 빈 모듈을 만드는 '새 모듈' 버튼이 생겼고, 모듈 화면의 모듈 메뉴(⋯)에 '사본 만들기'가 생겼어요. '설명', '토글', '로어북', '스크립트'('정규식'·'트리거'), '에셋', '삽화 프로필'이 새 모듈로 복사되고, 켜 둔 '사용처'는 원래 모듈에 남아요.",
    "- 설정 › API 연결의 'OpenAI' 연결이 추론 모델의 도구 호출을 지원하도록 'OpenAI Responses' 형식으로 바뀌었어요. 이 연결의 모델에서는 '모델 설정'의 '멈춤 문구', '빈도 억제', '존재 억제', '반복 억제', 'top_k', 'min_p', 'seed'가 제외되고, '응답 최대 길이'는 최소 16 토큰부터 적용돼요.",
    "- 설정 › 플러그인의 '새 플러그인'에서 원하는 동작을 적고 '만들기'를 누르거나 '빈 파일로 시작'을 눌러 앱 안에서 헤이젤 플러그인을 만들 수 있어요. 초안은 '만드는 중' 목록에 보관되고, 스튜디오의 '코드'·'AI'·'정보' 탭에서 코드를 다듬고 '이름'·'설명'·'버전'을 입력한 뒤 '적용'을 누르면 설치되거나 업데이트돼요. 설치한 헤이젤 플러그인은 플러그인 메뉴(⋯)의 '코드 편집'으로 다시 열 수 있고, 모든 플러그인은 메뉴(⋯)의 '내보내기'로 .js 파일로 저장할 수 있어요.",
    "- 플러그인 스튜디오의 '테스트' 탭에서 '채팅'과 '실행 시점'을 선택해 '테스트 실행'을 누르면 실제 채팅과 저장소를 건드리지 않고 초안을 실행해 볼 수 있어요. 오류가 나면 '코드에서 보기'로 해당 줄로 이동하거나 'AI로 수정'으로 수정을 맡길 수 있고, '새 플러그인'과 'AI' 탭에서 요청할 때도 모델이 스스로 여러 '실행 시점'과 가상 메시지로 코드를 테스트한 뒤 답해요.",
    "- 헤이젤 플러그인이 //@tool 헤더와 tool 이벤트로 '모델 도구'를 선언하면, '대화 모델'이 응답을 쓰는 도중에 필요한 도구를 호출하고 그 결과를 받아 응답을 이어 써요. 호출한 도구와 결과는 응답 아래에 한 줄로 표시되고, 도구를 지원하지 않는 모델이 요청을 거절하면 도구 없이 다시 보내 응답해요. 응답 하나에서 호출할 최대 횟수는 설정 › 채팅 › 세부 설정의 '모델 도구 호출 횟수'(기본 5회)에서 정해요. 'OpenAI 호환' 형식 연결의 도구 호출은 실제 모델에서 테스트해 보지 못했어요.",
    "- 헤이젤 플러그인에 //@input 헤더와 input 이벤트로 '입력창 버튼 항목'을 넣으면, 채팅 입력창의 플러그인 버튼으로 입력 중인 글을 읽고 바꿀 수 있어요. 실행 중에는 버튼이 '멈추기'로 바뀌고, 바뀐 뒤에는 알림의 '되돌리기'로 이전 글을 복원할 수 있어요.",
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
