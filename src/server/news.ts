import type { DatabaseSync } from 'node:sqlite';

// 소식 (design §6.15): the operator's board post for the release this build is, published by the server whose
// HAZELLE_VERSION it names at its first start. The deploy skill rewrites it for every release a user would notice and
// sets it to null for one that brings nothing to tell; once published, the post is the record and is edited on the board.
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.6',
  title: '응답이나 번역이 끝났을 때 소리로 알려 드려요',
  text: [
    '- 설정 › 소리에서 알림음을 켜면 응답이 시작될 때, 응답이 도착했을 때, 번역이 끝났을 때 소리로 알려요. 세부 설정에서 상황마다 띵, 딩동, 톡 중에 고르거나 끌 수 있어요.',
    '- 응답을 기다릴 때부터 쓰는 중까지 걸린 시간이 한 줄로 이어져 보여요. 설정 › 채팅 › 세부 설정에서 사용량 표시를 켜 두면 답을 쓰는 동안에도 지금까지 나온 출력 토큰을 실시간으로 함께 보여 줘요.',
    '- 캐릭터 없이 연 채팅은 유틸리티 봇처럼 프롬프트와 페르소나를 빼고 보내요.',
    '- 알림을 한 줄 모양으로 바꾸고, 되돌리기나 봇이 보낸 알림이 여러 개 겹쳐도 사라지지 않고 차례대로 기다리게 했어요. 긴 말은 보기를 눌러 전체를 펼쳐 볼 수 있어요.',
    '- 원문 함께 보기에서 원문이 한 칸씩 밀리거나 번역 뒤로 한꺼번에 몰리던 문제를 고치고, 문단 짝을 더 정확히 맞추도록 다듬었어요.',
    '- 화면을 새로고침한 뒤 사용량 표시 줄의 비용이 확인하는 중…에서 멈추던 문제를 고쳤어요.',
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
