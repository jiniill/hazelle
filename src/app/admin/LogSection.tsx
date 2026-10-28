import { readLog, type LogRow } from '../../runtime/admin';
import { sizeText } from '../common/size';
import { ago } from '../common/time';
import { BOARD, NOTICES } from '../common/words';
import { navigate } from '../shell/router';
import { ListItem, Panel } from '../ui';
import { restoreError } from '../common/RestoresDialog';
import { moment } from '../common/time';
import { HEAD_ROWS, PagedList, SeeAll, usePages } from '../common/useLoaded';

// The actions server/admin and server/board log. One they do not list shows as the server wrote it.
const ACTIONS: Record<string, string> = {
  suspend: '정지',
  lift: '정지 해제',
  'delete-account': '계정 삭제',
  'set-service': '서비스 설정',
  'set-board': '게시판 설정',
  'guest-block': '손님 글쓰기 차단',
  'set-caps': '저장 한도',
  'resolve-report': '신고 확인',
  'send-notice': NOTICES.send,
  'block-file': '파일 차단',
  'unblock-file': '파일 차단 해제',
  'hold-share': '링크 보류',
  'release-share': '링크 보류 해제',
  'block-share': '링크 차단',
  'restore-begun': '복원 시작',
  'restore-done': '복원 완료',
  'restore-cancelled': '복원 취소',
  'restore-failed': '복원 실패',
  'post-status': '글 상태 변경',
  'post-hide': '글 가림',
  'post-show': '글 가림 해제',
  'post-lock': '글 잠금',
  'post-unlock': '글 잠금 해제',
  'post-delete': '글 삭제',
  'comment-hide': '댓글 가림',
  'comment-show': '댓글 가림 해제',
  'comment-delete': '댓글 삭제',
};

const capText = (cap: unknown) => (typeof cap === 'number' ? sizeText(cap) : cap === 'default' ? '기본값' : '없음');

function detailOf({ action, detail }: LogRow): string | undefined {
  if (action === 'send-notice' && detail === null) return '모두에게';
  if (detail === null) return undefined;
  const values = detail as Record<string, unknown>;
  // Rows from before the 게시판 (migration 0015) answered a report; they live a year.
  if (action === 'send-notice' && typeof values.report === 'number') return `${String(values.username)} · 알림 ${values.report}에 답변`;
  if (action === 'post-status' && typeof values.status === 'string') return `${BOARD.statuses[values.status as keyof typeof BOARD.statuses] ?? values.status}${typeof values.version === 'string' ? ` · ${values.version}` : ''}`;
  if ((action === 'post-hide' || action === 'comment-hide') && typeof values.reason === 'string') return `${values.reason}${typeof values.days === 'number' ? ` · ${values.days}일` : ''}`;
  if (action === 'post-delete' && typeof values.title === 'string') return values.title;
  if (action === 'comment-delete' && typeof values.post === 'number') return `글 ${values.post}`;
  if (action === 'set-board' && typeof values.guests === 'boolean') return `손님 글쓰기 ${values.guests ? '열기' : '닫기'}`;
  if (action === 'set-caps') return `${String(values.username)} · 텍스트 한도 ${capText(values.bytesCap)} · 이미지 한도 ${capText(values.fileBytesCap)}`;
  if (action === 'restore-begun') return `${String(values.username)} · ${typeof values.at === 'number' ? `${moment(values.at)} 시점으로` : '복원 전으로 되돌리기'}`;
  if (action === 'restore-failed' && typeof values.error === 'string') return `${String(values.username)} · ${restoreError(values.error)}`;
  if (typeof values.username === 'string') return values.username;
  if (action === 'set-service' && typeof values.signupCap === 'number') {
    return `가입 정원 ${values.signupCap}명 · 계정당 텍스트 한도 ${capText(values.accountBytesCap)} · 계정당 이미지 한도 ${capText(values.accountFileBytesCap)}`;
  }
  return JSON.stringify(detail);
}

// Print target only when it adds identity: account username is already in detail; service/everyone repeats the action.
function codeOf({ target, detail }: LogRow): string | undefined {
  if (target === 'service' || target === 'everyone') return undefined;
  return typeof (detail as Record<string, unknown> | null)?.username === 'string' ? undefined : target;
}

// head: the newest few, which 운영 shows.
export function LogSection({ head }: { head: boolean }) {
  const pages = usePages((after) => readLog(after, head ? { limit: HEAD_ROWS } : {}));
  return (
    <Panel title="기록" action={head && !pages.whole ? <SeeAll onClick={() => navigate({ kind: 'admin-list', list: 'log' })} /> : undefined}>
      <PagedList pages={pages} head={head} label="기록" empty="아직 기록이 없어요.">
        {(row) => <ListItem key={row.id} title={ACTIONS[row.action] ?? row.action} code={codeOf(row)} description={detailOf(row)} note={ago(row.at)} />}
      </PagedList>
    </Panel>
  );
}
