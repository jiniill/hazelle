import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.14',
  title: 'Risu에서 옮긴 채팅의 장기 기억을 기록으로 가져오고, 새 사용자의 기본 대화 프롬프트에서 날짜 줄을 뺐어요',
  text: `- 'Risu에서 이사'나 '채팅 가져오기'('Risu 채팅 파일')로 Risu의 채팅을 가져올 때, Risu의 장기 기억(HypaMemory V2·V3, SupaMemory)이 남긴 요약을 '장기 기억'의 '기록'으로 함께 가져와요. 요약마다 어디까지의 대화를 정리했는지 맞춰 저장하므로 Risu에서 요약해 둔 지난 대화가 다음 요청에도 이어서 들어가고, 가져온 '기록'이 있는 채팅은 '장기 기억'의 '사용'이 켜진 채로 시작해요. '장기 기억' 패널에서 해당 '기록'을 열면 아래에 'Risu에서 옮긴 기록'으로 표시돼요.
- 삭제된 메시지를 가리키는 요약이나 빈 요약, 한 채팅에 여러 기억 형식이 함께 남아 있을 때 쓰이지 않던 이전 형식은 제외하고, 일부라도 빠진 채팅은 '가져오지 못한 항목'(미리보기에서는 '가져올 수 없는 항목')에 '장기 기억을 다 옮기지 못한 채팅 N개'로 표시해요. 업데이트 전에 옮긴 채팅에는 소급 적용되지 않으며, HypaPlus·LIBRA 같은 장기 기억 플러그인의 기억은 가져오지 않아요.
- 새로 시작하는 계정과 손님에게 만들어지는 '기본 대화' 프롬프트에서 응답 첫머리에 날짜와 시각 줄(⏱️[YYYY-MM-DD (dayOfWeek) HH:MM AM/PM])을 붙이던 지시를 뺐어요. 기존 계정의 '기본 대화' 프롬프트는 바뀌지 않아요.`,
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
