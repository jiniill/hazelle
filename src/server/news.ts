import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.20',
  title: '본문에서 추론 블록 접어 보기를 추가했어요',
  text: `## 본문에서 추론 접어 보기
- **본문 제자리에서 접어 보기**: 응답이나 봇 정규식이 만든 추론 블록이 메시지 본문 제자리에 접혀 표시되어, **추론**을 눌러 펼쳐 볼 수 있어요.
- **접지 않고 보기**: 캐릭터 편집에서 **추론을 본문에 표시**를 켜면 추론 블록을 접지 않고 본문에 보여 줘요.
- **응답 정보 구분**: **응답 정보**의 추론 항목에는 모델이 보낸 추론 과정만 표시돼요.

## 헤이젤 가이드 개편
- **API 키 받는 법 추가**: 새로 추가된 **Claude·GPT·Gemini API 키 받는 법** 가이드에서 OpenRouter·OpenAI·Anthropic·Google의 키 발급과 연결 순서를 볼 수 있어요.
- **목차와 단계별 안내**: **헤이젤 가이드**에서 준비할 것과 단계별 이미지, 자주 묻는 질문을 보고 목차를 눌러 원하는 항목으로 이동할 수 있어요.
- **백업 이사 안내 보강**: **RisuAI·포켓리스 백업 옮기는 법**에서 백업으로 옮겨지는 항목과 제외되는 항목을 비교해 볼 수 있어요.

## 그 밖의 개선
- **첫 화면에서 키 없이 둘러보기**: 처음 방문했을 때 API 키 입력 칸 아래의 **키 없이 둘러보기**를 눌러 키를 넣지 않고 앱을 열 수 있어요.
- **채팅 맨 아래 여백 확보**: 대화를 끝까지 내렸을 때 마지막 메시지의 버전 넘기기와 도구 줄이 **맨 아래로** 버튼 자리에 가려지지 않아요.
- **Anthropic 키 페이지 주소 변경**: **Anthropic 연결**의 키 발급 링크가 새 주소인 \`platform.claude.com\`으로 열려요.\`,
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
