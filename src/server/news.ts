import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.7',
  title: '캐시가 깨졌을 때 고치는 방법과 아끼는 금액을 미리 계산해 보여 줘요',
  text: [
    '- 설정 › 실험실에서 캐시 보호를 켜면 채팅 메뉴 › 점검 › 요청의 캐시에 고치는 방법이 생겨요. 대화 뒤로 옮기기, 항상 켜기, 사용자 역할로 보내기 중에 실제로 캐시를 더 읽는 방법만 골라, 읽는 토큰이 얼마나 늘고 얼마가 절약되는지 아끼는 금액이 큰 순서로 보여 줘요.',
    '- 항목을 눌러 어떻게 바뀌는지 미리 보고 바로 고칠 수 있어요. 고친 뒤에는 알림의 되돌리기로 원래대로 돌릴 수 있어요.',
    '- 캐릭터 없이 연 채팅에서도 이 채팅의 프롬프트에서 기본 프롬프트 따르기나 다른 프롬프트를 골라 프롬프트와 페르소나를 넣어 보낼 수 있어요. 유틸리티 봇처럼을 고르면 다시 빼고 보내요.',
    '- 유틸리티 봇이나 유틸리티 봇처럼 보내는 캐릭터 없이 채팅은 기본 프롬프트가 없어도 대화를 보낼 수 있어요.',
    '- 헤이젤 나우가 이제 로그인한 계정만 세고, 손님과 직접 설치한 헤이젤에서는 집계 표시를 보내지 않아요. 이에 맞춰 개인정보 처리방침을 고쳤어요. 손님이 응답을 받으면 모델이나 연결 종류 없이 손님 id만 보내 하루 손님 수만 세고 7일 뒤 지워요. 일별 방문자 수와 손님 수는 접속 주소 하나에서 하루에 각각 32명, 8명까지만 세고, 공유 링크의 받은 횟수는 방문자마다 하루 한 번만 올라가요.',
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
