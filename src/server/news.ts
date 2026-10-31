import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.4',
  title: '장기 기억 누락 원인 안내와 정리 보완, 캐시 표시 스위치, 오류 제보·진단 개선',
  text: [
    "- '보내기' 버튼 옆 '요청에서 제외될 메시지'('메시지 N개') 경고가 무조건 '기억에 없음'이라고만 뜨던 문제를 고쳐, '기억 정리 중'·'기억 정리 실패'·'플러그인 응답 전'·'장기 기억 꺼짐'·'프롬프트에 기억 없음'·'원문 바뀜'·'기록 한도 넘음'·'기록 삭제됨'·'컨텍스트 부족' 등 실제 원인을 보여 주고 누르면 '장기 기억' 패널을 열어요. 또한 '원문으로 보낼 최근 대화' 범위 안이라도 컨텍스트 한도 때문에 요청에서 빠진 옛 메시지는 남은 원문의 절반까지 함께 요약해 매 턴 캐시가 깨지지 않게 하고, 컨텍스트 길이가 짧은 모델을 쓸 때도 실제 요청의 기억 한도에 맞춰 옛 '기록'을 '챕터'로 묶어 대화가 요청과 기억 양쪽에서 빠지지 않게 했어요.",
    "- '보내기' 버튼 옆에 뜨는 캐시 남은 시간과 경고를 숨길 수 있는 '캐시 표시' 스위치를 설정 › 채팅 › 세부 설정의 '응답'과 채팅의 점검 › '캐시'에 추가했어요. 꺼 두어도 캐시는 그대로 작동하고 점검 › '캐시'에서 확인할 수 있으며, 설정은 계정에 저장되어 다른 기기에서도 유지돼요.",
    "- '헤이젤이 처음이라면'('튜토리얼 보기')과 완료한 튜토리얼, 새 기능 안내 대화상자, '새 버전으로 바뀌었어요' 알림을 본 기록과 도구 › '번역기'의 '번역할 언어'가 기기가 아닌 계정에 저장돼요. 기존 기기에 있던 값도 계정으로 자동 이전되어 다른 기기나 브라우저에서 열어도 선택한 번역 언어가 유지되고 이미 본 안내가 다시 뜨지 않아요.",
    "- 앱 오류나 봇 '스크립트' 오류가 났을 때 뜨는 알림에 '오류 제보' 버튼이 생겨, 누르면 '게시판'의 '글쓰기' 화면이 '버그' 분류와 '운영자에게만'이 켜진 상태로 열려요. '운영자에게만' 글을 쓸 때 '진단 정보 함께 보내기'(및 설정 › 계정 › '앱 정보'의 '문제 진단' › '진단하기')에 방금 보던 화면의 설정값·항목 수·토큰 수·'장기 기억' 상태·모델 ID·연결 방식·'플러그인'과 '모듈' 이름 및 버전이 담긴 '앱 상태'가 함께 들어가고(대화 내용·캐릭터·페르소나·프롬프트 원문이나 이름·API 키는 제외, 봇·'플러그인' 말풍선 알림은 '최근 오류'에서 제외), '글쓰기' 화면의 '진단 정보' 칸에서 전송될 내용을 미리 보고 기본 '재현 순서' 양식을 고치지 않아도 바로 '올리기'를 누를 수 있어요.",
    "- 설정 › 계정 › '앱 정보'에 '자동 진단 보내기' 스위치와 관련 '개인정보 처리방침' 안내를 추가했어요(기본 켜짐, '손님' 계정과 '직접 설치한 헤이젤' 제외). 켜 두면 오류나 기억 누락 경고가 생겼을 때 계정 ID·대화 내용·이름·오류 문구·API 키 없이 문제 종류와 앱 버전·브라우저 종류·모델·설정값·개수·토큰 수·상태만 자동으로 보내 문제를 빨리 파악할 수 있게 도와줘요.",
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
