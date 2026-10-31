import type { DatabaseSync } from 'node:sqlite';

// Release copy ships with the build, published once under HAZELLE_VERSION. Deploy updates this text or clears it
// for silent releases; after publication the board post is the editable record (design §6.15).
export type ReleaseNews = { version: string; title: string; text: string };
export const RELEASE_NEWS: ReleaseNews | null = {
  version: 'v0.6.5',
  title: '운영자에게만 보내는 글에 사진을 첨부할 수 있어요',
  text: [
    "- '게시판'의 '글쓰기'에서 '공개 범위'를 '운영자에게만'으로 선택했을 때(또는 '운영자에게만 보내기'·'오류 제보'로 열었을 때) '사진 추가' 버튼을 누르거나 '내용' 칸에 이미지를 붙여 넣어 글 하나에 3장, 하루에 9장까지 사진을 첨부할 수 있어요('손님'과 '정지됨' 계정 제외). 글을 올린 뒤에도 글 화면에서 '사진 추가'로 사진을 더 올리거나, 첨부한 사진을 눌러 크게 보고 '빼기'를 눌러 '삭제'할 수 있어요.",
    "- 첨부하는 사진은 브라우저에서 다시 그려 위치 같은 파일 부가 정보를 빼고 전송하며, 암호화되지 않으며 글쓴이와 운영자만 볼 수 있어요. 이에 맞춰 '개인정보 처리방침'에 '운영자에게만' 보낸 글의 첨부 사진 보유·열람·삭제 안내를 추가했어요(글쓴이나 운영자가 삭제할 수 있고, 탈퇴 후에도 남았다가 운영자가 '확인함'·'완료'·'안 함'으로 표시한 날부터 1년이 지나면 삭제돼요).",
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
