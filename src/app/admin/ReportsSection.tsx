import { Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { readReports, resolveReport, type Report } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { ago } from '../common/time';
import { useAttempt } from '../common/useAttempt';
import { NOTICES } from '../common/words';
import { navigate } from '../shell/router';
import { Button, Callout, Dialog, ListItem, Panel, Section, Stack, Text } from '../ui';
import { ShareReportDialog } from './ShareReportDialog';
import { shareTags } from './shareTags';
import { HEAD_ROWS, PagedList, SeeAll, usePages } from '../common/useLoaded';

type BoardReport = Report & { postId: number };

const reporter = (report: Report) => report.username ?? '익명';
const what = (report: Report) => (report.share !== null ? '링크' : report.commentId !== null ? '댓글' : '글');

// Share reports use ShareReportDialog; board reports use this dialog. Refresh open-report heads after acts
// so the next waiting report appears without refetching whole lists.
export function ReportsSection({ head, onActed }: { head: boolean; onActed?: () => void }) {
  const pages = usePages((after) => readReports(after, head ? { open: true, limit: HEAD_ROWS } : {}));
  const [open, setOpen] = useState<Report | null>(null);
  const acted = (resolvedAt: number) => {
    if (head || !open) pages.reload();
    else pages.update((shown) => shown.map((row) => (row.id === open.id ? { ...row, resolvedAt } : row)));
    setOpen(null);
    onActed?.();
  };
  return (
    <Panel
      title={NOTICES.received}
      help={head ? '확인하지 않은 신고만 여기에 보여요.' : undefined}
      // Not hidden when the head is whole: it holds only the open reports, and the resolved ones are behind this door.
      action={head ? <SeeAll onClick={() => navigate({ kind: 'admin-list', list: 'reports' })} /> : undefined}
    >
      <PagedList pages={pages} head={head} label={NOTICES.received} empty={head ? '확인할 신고가 없어요.' : `${NOTICES.received}이 없어요.`}>
        {(report) => (
          <ListItem
            key={report.id}
            title={`${what(report)} 신고 · ${reporter(report)}`}
            tags={[...(report.resolvedAt === null ? [] : ['확인함']), ...(report.shared ? shareTags(report.shared) : [])]}
            note={ago(report.createdAt)}
            description={report.text}
            onClick={() => setOpen(report)}
          />
        )}
      </PagedList>
      {open?.share != null && (
        <ShareReportDialog
          report={open as Report & { share: string; shareVersion: number; link: string }}
          onClose={() => setOpen(null)}
          onActed={() => {
            pages.reload();
            setOpen(null);
            onActed?.();
          }}
        />
      )}
      {open?.postId != null && <BoardReportDialog report={open as BoardReport} onClose={() => setOpen(null)} onResolved={acted} />}
    </Panel>
  );
}

// What was reported, as it reads now; what to do about it is done on the post itself.
function BoardReportDialog({ report, onClose, onResolved }: { report: BoardReport; onClose: () => void; onResolved: (at: number) => void }) {
  const { busy, failure, run } = useAttempt();
  const resolve = () =>
    run(async () => {
      const resolved = await resolveReport(report.id);
      if (!resolved.ok) return describeFailure(resolved);
      onResolved(Date.now());
      return null;
    });
  const reported = report.commentId === null ? report.postTitle : report.commentText;
  return (
    <Dialog
      title={`${reporter(report)}의 ${what(report)} 신고`}
      note={ago(report.createdAt)}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" icon={ExternalLink} onClick={() => navigate({ kind: 'post', id: report.postId })}>
            글 열기
          </Button>
          {report.resolvedAt === null && (
            <Button icon={Check} busy={busy} onClick={() => void resolve()}>
              확인 처리
            </Button>
          )}
        </>
      }
    >
      <Stack gap="group">
        <Section level={3} title="신고 이유">
          <Text variant="prose">{report.text}</Text>
        </Section>
        <Section level={3} title={`신고한 ${what(report)}`}>
          {reported === null ? <Text variant="note">삭제됐어요.</Text> : <Text variant="prose">{reported}</Text>}
        </Section>
        {failure && (
          <Callout tone="warn" alert>
            {failure}
          </Callout>
        )}
      </Stack>
    </Dialog>
  );
}
