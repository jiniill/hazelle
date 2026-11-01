import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.6',
  title: '장기 기억에서 챕터가 한도를 채우면 오래된 챕터를 하나로 묶고, 원문이 바뀌어도 챕터를 계속 보내요',
  text: [
    "- '장기 기억'에서 '챕터'가 '기록 최대 분량' 중 '상태'·'미해결 사건'·'고정' 및 '원문 메시지 보내기' 요약본을 뺀 남은 한도의 90% 이상을 채우면, 새 '챕터'를 만들기 전에 이웃한 오래된 '챕터'를 2~4개씩 약 1/4 분량의 '챕터' 하나로 묶어요. 기존 채팅에서 '챕터'가 이 한도를 채운 상태라면 채팅을 열 때 '기억 모델'을 호출해 묶으며, 다른 기억 정리처럼 호출 비용이 발생해요. 직접 편집했거나 '고정'을 켠 '챕터', 원문 메시지가 바뀐 '챕터', 직접 편집했거나 '고정'·'원문 메시지 보내기'를 켠 '기록'이 들어 있는 '챕터'는 묶지 않아요. '챕터' 묶기는 '컨텍스트 길이'가 짧은 모델에 맞춰 줄어든 한도가 아니라 저장된 '기록 최대 분량' 설정을 기준으로 판단하므로, 짧은 모델로 바꿨을 때는 오래된 '챕터'가 묶이지 않고 '한도 넘음'으로만 빠졌다가 큰 모델로 돌아오면 유지돼요. 한 번 묶인 '챕터'는 오래된 사건의 요약이 더 짧아지고 저절로 풀리지 않으며, 되돌리려면 그 '챕터'에서 '원문에서 다시 만들기'를 누르면 돼요(묶인 '챕터'의 원문 메시지가 한 번에 읽을 분량을 넘을 때는 묶인 '챕터'를 풀고 원문 메시지에서 '챕터'를 다시 만들어요).",
    "- '챕터'에 묶인 원문 메시지를 수정하거나 다른 버전으로 바꾸거나 삭제해도, '챕터'를 빼고 '기록'을 대신 보내거나 백그라운드에서 '기록'을 자동으로 다시 요약하지 않고 기존 '챕터'를 계속 보내요. '기록' 목록에는 '원문 바뀜' 태그가 붙고, 열면 '대화 원문이 바뀌었어요. 이 챕터는 계속 보내요.'(또는 '원문 메시지가 삭제됐어요. 이 챕터는 계속 보내요.') 안내가 나와서 원할 때 '원문에서 다시 만들기'로 반영할 수 있어요. 반대로 '챕터' 안의 '기록'을 직접 편집·삭제하거나 '원문에서 다시 만들기'로 다시 요약한 경우에는 '기록 바뀜'으로 표시하고 '챕터'를 다시 만들 때까지 '기록'을 대신 보내요.",
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
