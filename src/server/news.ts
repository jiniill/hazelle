import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.18',
  title: '캐릭터 최근 정렬이 캐릭터를 추가하거나 편집한 시각도 반영하고, 같은 말을 반복하는 응답을 감지해 멈춰요',
  text: `## 캐릭터 최근 정렬
- **'최근'으로 이름 변경**: '캐릭터 둘러보기'와 휴대폰 캐릭터 목록의 '정렬'에서 '최근 대화'가 '최근'으로 바뀌었어요.
- **추가·편집 시각 반영**: 이제 '최근' 정렬은 마지막 대화 시각뿐 아니라 '새 캐릭터', '봇 가져오기', '링크로 가져오기', 'Risu에서 이사', '사본 만들기'로 캐릭터를 추가하거나 캐릭터 편집에서 카드 내용('프로필', '캐릭터', '첫인사', '지시문', '기본 변수')을 바꾼 시각 중 더 늦은 시각 순서로 캐릭터를 보여 줘요.
- **새 캐릭터는 맨 위로**: 대화가 없어도 새로 가져오거나 만든 캐릭터가 목록 맨 위에 올라오며, 대화와 캐릭터 변경 시각이 모두 없는 캐릭터는 뒤쪽에 이름순으로 놓여요.
- **기존 캐릭터**: 업데이트 전에 있던 캐릭터는 다음번에 카드를 편집할 때부터 변경 시각이 기록돼요.

## 반복 응답 감지
- **감지 기준**: 응답 본문이나 '추론'에서 공백이 아닌 같은 글자가 256번 연속으로 나오거나 128자 이하의 같은 구간이 2,048자 이상 되풀이되면, 반복으로 감지해 읽기를 멈추고 그때까지 받은 내용만 남겨요.
- **표시**: 메시지 아래에는 '반복돼서 멈춤'과 함께 '이어 쓰기' 대신 '다시 시도' 버튼이 나오고(자동 '이어 쓰기'도 실행되지 않아요), '응답 정보'와 '점검'의 '기록'에 나오는 '종료 사유'에는 '반복 감지'로 표시돼요.
- **제공자 호출 중단**: 스트리밍 응답은 감지한 시점에 제공자 호출도 함께 중단해 뒷부분이 더 생성되지 않으며, '모델 설정'에서 '스트리밍'을 껐거나 '할인 받기'로 한 번에 받은 응답은 사용량과 비용을 남기고 '반복돼서 멈춤'으로 표시해요.

## 그 밖의 개선
- **Google 재시도 대기 시간**: 'Google'과 'Vertex AI' 연결에서 일시적인 오류로 '실패하면 다시 보내기'가 동작할 때, 응답 헤더뿐 아니라 Google API가 오류 본문에 담아 보낸 대기 시간도 읽어서 요청한 시간(최대 1분)만큼 기다린 뒤 다시 보내요. 대기 시간이 1분을 넘으면 다시 보내지 않고 실패로 알려 줘요.`,
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
