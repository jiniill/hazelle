import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.5.10',
  title: '점검에 캐시 탭이 생기고, 대화 뒤 시스템 메시지가 제자리에 들어가요',
  text: [
    "- Gemini와 Claude 연결에서 대화가 시작된 뒤에 오는 시스템 메시지를 요청 맨 앞으로 끌어올리지 않고, RisuAI처럼 제자리에 사용자 메시지로 보내요(Gemini는 'system:', Claude는 'System: '을 앞에 붙여요). 채팅 블록 뒤에 장기 기억이나 로어북을 두는 프롬프트에서도 차례가 넘어갈 때 앞부분 캐시가 유지되고, 모델이 그 블록을 따르는 느낌이 조금 달라질 수 있어요.",
    '- 채팅 메뉴 › 점검에 캐시 탭이 생겼어요. 요청과 기록 탭에 나뉘어 있던 다음 전송 예상과 지난 응답의 캐시 기록, 설정 › 실험실의 캐시 보호를 켰을 때 나오는 고치는 방법을 함께 볼 수 있어요. 보내기 버튼 옆 캐시 표시나 응답 정보의 캐시 점검을 누르면 점검 › 캐시가 열려요.',
    '- 캐시 지점 없이 제공자가 앞부분을 알아서 캐시하는 Gemini, OpenAI 같은 연결에서도 한 번 캐시를 읽은 뒤부터 다음 전송의 캐시 예상과 깨진 원인, 고치는 방법을 보여 줘요. 유지 시간은 알 수 없어서 남은 시간 시계 없이 깨짐 예상만 표시해요.',
    '- 채팅에서 입력하던 메시지를 이 기기에 암호화해 두어 화면을 새로고침하거나 잠그기를 눌러도 남아요. 메시지를 보내거나 로그아웃하면 삭제되고, 첨부한 이미지와 텍스트 파일은 남기지 않아요.',
    '- 서버에 저장하지 못한 내용이나 생성 중인 응답이 있을 때 설정 › 계정에서 잠그기나 로그아웃을 누르면 멈추고 알려 줘요. 알림의 그래도 나가기를 누르면 저장을 기다리지 않고 나갈 수 있어요.',
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
