import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.7.6',
  title: '모델 요청을 브라우저에서 바로 보낼 수 있어요',
  text: `## 브라우저 직접 요청
- **바로 요청하기**: **설정 › 계정**의 브라우저 직접 요청 스위치는 기본으로 꺼져 있고, 켜면 Hazelle 서버를 거치지 않고 브라우저에서 모델 제공자에게 바로 요청을 보내요.
- **응답 끊김 주의**: 스위치를 켠 채로 탭을 닫거나 새로고침하면 받던 응답이 끊겨요.
- **일부 연결 제한**: 브라우저에서 보내는 요청을 막는 연결에서는 쓸 수 없어요.

## 새 탭에서 열기
- **캐릭터 새 탭**: 캐릭터 목록과 왼쪽 캐릭터 얼굴, 캐릭터 둘러보기 카드를 마우스 가운데 버튼이나 Ctrl 클릭으로 누르면 새 탭에서 열려요.
- **채팅 새 탭**: 채팅 목록은 Ctrl·Shift 클릭이 여러 개 고르기라서 마우스 가운데 버튼으로만 새 탭에서 열려요.
- **일반 클릭은 그대로**: 그냥 클릭하면 전과 똑같이 이동해요.

## 그 밖의 개선
- **게시판 팁 분류**: 알아낸 기능이나 활용법을 나누는 팁 분류가 새로 생겼어요.
- **장기 기억 중간 저장**: 기억 정리 중 기록 하나가 거절돼도 전부 버리지 않고 그 앞까지 읽은 내용은 저장해, 나머지만 다음 정리 때 다시 해요.
- **보조 작업 반복 실패 해결**: 기억 정리 같은 보조 작업에서 모델 설정 때문에 같은 실패가 되풀이되던 문제를 고쳤어요.`,
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
