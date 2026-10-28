import { Ban, Check, Eye, Play } from 'lucide-react';
import { useState } from 'react';
import { blockShare, readShareVersions, releaseShare, resolveReport, type Report } from '../../runtime/admin';
import type { ApiResult } from '../../runtime/api';
import { openVersion, type Opened } from '../../runtime/share';
import { describeFailure } from '../common/failure';
import { SharePreview } from '../common/SharePreview';
import { ago } from '../common/time';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, Checkbox, Dialog, Stack, Text } from '../ui';
import { NoticeDialog } from './NoticeDialog';
import { shareTags } from './shareTags';

type ShareReport = Report & { share: string; shareVersion: number; link: string };

// A report on a share link: 열어 보기 opens the version the reporter saw with the key the report's link holds, 보류 풀기
// opens the link again and marks it reviewed, 차단 blocks that version's files and tells its sharer.
export function ShareReportDialog({ report, onClose, onActed }: { report: ShareReport; onClose: () => void; onActed: () => void }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [suspend, setSuspend] = useState(false);
  const { busy, failure, run, setFailure } = useAttempt();
  const source = { id: report.share, operator: true };
  const { shared } = report;
  const title = `${report.username ?? '익명'}의 링크 신고`;

  const view = () =>
    run(async () => {
      const versions = await readShareVersions(report.share);
      if (!versions.ok) return describeFailure(versions);
      const version = versions.data.versions.find(({ version }) => version === report.shareVersion);
      if (!version) return '신고된 버전을 찾을 수 없어요.';
      const read = await openVersion(source, version.manifest, report.link.slice(report.link.indexOf('#') + 1));
      if (!read.ok) return read.error === 'unreadable' ? '신고된 링크의 키로 내용을 열 수 없어요.' : describeFailure(read);
      setOpened(read.data);
      return null;
    });
  const act = (done: Promise<ApiResult<unknown>>) =>
    run(async () => {
      const result = await done;
      if (!result.ok) return describeFailure(result);
      onActed();
      return null;
    });

  if (blocking) {
    return (
      <NoticeDialog
        title="링크 차단"
        note={`버전 ${report.shareVersion}`}
        label="공유한 사람에게 보낼 알림"
        placeholder="예: 미성년자로 보이는 캐릭터의 성적인 이미지가 있어 링크를 내렸어요."
        confirm={{ label: '차단', icon: Ban }}
        about={<Checkbox label="계정도 정지" note="작성한 내용을 정지 사유 알림으로 보내요." checked={suspend} onChange={setSuspend} />}
        send={(text) => blockShare(report.share, report.shareVersion, text, suspend)}
        onSent={onActed}
        onClose={() => setBlocking(false)}
      />
    );
  }
  const open = shared !== null && !shared.removed;
  return (
    <Dialog
      title={title}
      note={ago(report.createdAt)}
      onClose={onClose}
      actions={
        <>
          {!opened && (
            <Button variant="secondary" icon={Eye} busy={busy} onClick={() => void view()}>
              열어 보기
            </Button>
          )}
          {open && shared.held && (
            <Button variant="secondary" icon={Play} busy={busy} onClick={() => void act(releaseShare(report.share))}>
              보류 해제
            </Button>
          )}
          {report.resolvedAt === null && (
            <Button variant="secondary" icon={Check} busy={busy} onClick={() => void act(resolveReport(report.id))}>
              확인 처리
            </Button>
          )}
          {open && (
            <Button variant="danger" icon={Ban} onClick={() => setBlocking(true)}>
              차단
            </Button>
          )}
        </>
      }
    >
      <Stack gap="related">
        <Text variant="prose">{report.text}</Text>
        <Text variant="note">{`버전 ${report.shareVersion} · ${shared ? `${shared.ownerName ?? '?'}의 링크 · ${shareTags(shared).join(' · ') || '공개 중'}` : '공유한 계정이 탈퇴해 사라진 링크'}`}</Text>
      </Stack>
      {opened && <SharePreview source={source} opened={opened} failed={setFailure} />}
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
    </Dialog>
  );
}
