import type { LogRow, OwnCap } from '../../contracts/admin';
import { readLog } from '../../runtime/service/admin';
import { sizeText } from '../common/size';
import { ago, moment } from '../common/time';
import { BOARD, NOTICES, onOff } from '../common/words';
import { navigate } from '../shell/router';
import { ListItem, Panel } from '../ui';
import { restoreError } from '../common/RestoresDialog';
import { HEAD_ROWS, PagedList, SeeAll, usePages } from '../common/useLoaded';

const ACTIONS: Record<LogRow['action'], string> = {
  suspend: '정지',
  lift: '정지 해제',
  'delete-account': '계정 삭제',
  'set-service': '서비스 설정',
  'set-board': '게시판 설정',
  'set-backup-folder': '백업 폴더 설정',
  'set-pulse': '헤이젤 나우 설정',
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

const capWords = (cap: OwnCap) => (typeof cap === 'number' ? sizeText(cap) : cap === 'default' ? '기본값' : '없음');
const held = ({ reason, days }: { reason: string; days: number | null }) => `${reason}${days === null ? '' : ` · ${days}일`}`;

function detailOf(row: LogRow): string | undefined {
  switch (row.action) {
    case 'send-notice':
      if (row.detail === null) return '모두에게';
      // Rows from before the 게시판 (migration 0015) answered a report; they live a year.
      return 'report' in row.detail ? `${row.detail.username} · 알림 ${row.detail.report}에 답변` : row.detail.username;
    case 'post-status':
      return `${BOARD.statuses[row.detail.status]}${row.detail.version === null ? '' : ` · ${row.detail.version}`}`;
    case 'post-hide':
    case 'comment-hide':
      return held(row.detail);
    case 'post-delete':
      return row.detail.title;
    case 'comment-delete':
      return `글 ${row.detail.post}`;
    case 'set-board':
      return `손님 글쓰기 ${row.detail.guests ? '열기' : '닫기'}`;
    case 'set-caps':
      return `${row.detail.username} · 텍스트 한도 ${capWords(row.detail.bytesCap)} · 이미지 한도 ${capWords(row.detail.fileBytesCap)}`;
    case 'restore-begun':
      return `${row.detail.username} · ${row.detail.at === null ? '복원 전으로 되돌리기' : `${moment(row.detail.at)} 시점으로`}`;
    case 'restore-failed':
      return row.detail.error === null ? row.detail.username : `${row.detail.username} · ${restoreError(row.detail.error)}`;
    case 'restore-done':
    case 'restore-cancelled':
    case 'suspend':
    case 'lift':
    case 'delete-account':
      return row.detail.username;
    case 'set-service':
      return `가입 정원 ${row.detail.signupCap}명 · 계정당 텍스트 한도 ${capWords(row.detail.accountBytesCap)} · 계정당 이미지 한도 ${capWords(row.detail.accountFileBytesCap)}`;
    case 'set-backup-folder':
      return row.detail.folder ?? '폴더 없음';
    case 'set-pulse':
      return `손님 집계 ${onOff(row.detail.guests)}`;
    case 'block-share':
      return `버전 ${row.detail.version}`;
    // The rest carry no detail.
    default:
      return undefined;
  }
}

// Print target only when it adds identity: account username is already in detail; service/everyone repeats the action.
function codeOf({ target, detail }: LogRow): string | undefined {
  if (target === 'service' || target === 'everyone') return undefined;
  return detail !== null && 'username' in detail ? undefined : target;
}

// head: the newest few, which 운영 shows.
export function LogSection({ head }: { head: boolean }) {
  const pages = usePages((after) => readLog(after, head ? { limit: HEAD_ROWS } : {}));
  return (
    <Panel title="기록" action={head && !pages.whole ? <SeeAll onClick={() => navigate({ kind: 'admin-list', list: 'log' })} /> : undefined}>
      <PagedList pages={pages} head={head} label="기록" empty="아직 기록이 없어요.">
        {(row) => <ListItem key={row.id} title={ACTIONS[row.action]} code={codeOf(row)} description={detailOf(row)} note={ago(row.at)} />}
      </PagedList>
    </Panel>
  );
}
