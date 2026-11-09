import { useEffect, useState } from 'react';
import { MAX_REPORT_LENGTH } from '../../contracts/admin';
import { openVersion, type Opened } from '../../runtime/share';
import { countReceived, readShareState, reportShare, shareLink } from '../../runtime/share-link';
import { describeFailure } from '../common/failure';
import { LegalNotice } from '../common/LegalNotice';
import { SharePreview } from '../common/SharePreview';
import { ReportDialog } from '../common/ReportDialog';
import { ACTS } from '../common/acts';
import { LOADING, SHARE } from '../common/words';
import { Brand, Button, Callout, Divider, Intro, Screen, Stack, Text } from '../ui';
import { holdPending } from '../common/sharePending';

type View =
  | { kind: 'loading' }
  | { kind: 'live'; opened: Opened; version: number; received: number }
  | { kind: 'held' }
  | { kind: 'gone' }
  // A link cut short of its key, or a key that does not open it.
  | { kind: 'broken' }
  | { kind: 'failed'; failure: string };

export function SharePage({ id, shareKey }: { id: string; shareKey: string | null }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async (): Promise<View> => {
      if (shareKey === null) return { kind: 'broken' };
      const state = await readShareState(id);
      if (!state.ok) return { kind: 'failed', failure: describeFailure(state) };
      if (state.data.state !== 'live') return { kind: state.data.state };
      const opened = await openVersion({ id, operator: false }, state.data.manifest, shareKey);
      if (opened.ok) return { kind: 'live', opened: opened.data, version: state.data.version, received: state.data.received };
      return opened.error === 'unreadable' ? { kind: 'broken' } : { kind: 'failed', failure: describeFailure(opened) };
    })().then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [id, shareKey, attempt]);

  const received = () => void countReceived(id);
  // The workspace takes the link from here after a reload, through the sign-in or unlock it may need.
  const bring = () => {
    if (shareKey !== null && holdPending({ id, key: shareKey })) location.reload();
    else setFailure('이 브라우저에서는 바로 가져올 수 없어요. 파일로 받은 뒤 가져와 주세요.');
  };

  return (
    <Screen
      top={
        <>
          <Brand />
          {view.kind === 'live' && (
            <Button variant="link" icon={ACTS.report.icon} onClick={() => setReporting(true)}>
              {ACTS.report.label}
            </Button>
          )}
        </>
      }
      width="narrow"
      foot={<LegalNotice />}
    >
      {view.kind === 'loading' && <Text variant="note">{LOADING}</Text>}
      {view.kind === 'failed' && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => setAttempt((held) => held + 1) }}>{view.failure}</Callout>}
      {view.kind === 'held' && <Intro title="보류된 링크">{SHARE.heldNote}</Intro>}
      {view.kind === 'gone' && <Intro title="존재하지 않는 링크">{SHARE.goneNote}</Intro>}
      {view.kind === 'broken' && <Intro title="유효하지 않은 링크">주소의 # 뒷부분까지 모두 복사했는지 확인해 주세요.</Intro>}
      {view.kind === 'live' && (
        <Stack gap="section">
          <SharePreview
            source={{ id, operator: false }}
            opened={view.opened}
            first={<Button onClick={bring}>{SHARE.bring}</Button>}
            received={view.received}
            onDownloaded={received}
            failed={setFailure}
          />
          {failure && <Callout tone="warn" alert>{failure}</Callout>}
          {said && <Callout tone="success">{said}</Callout>}
        </Stack>
      )}
      {reporting && view.kind === 'live' && shareKey !== null && (
        <ReportDialog
          title={ACTS.report.label}
          lines={4}
          help="운영자가 이 링크를 열어 확인해요. 확인하는 동안 링크가 보류될 수 있어요."
          placeholder="예: 미성년자로 보이는 캐릭터의 성적인 이미지가 있어요."
          max={MAX_REPORT_LENGTH}
          quiet
          cancel
          send={(text) => reportShare(id, text, shareLink(location.origin, id, shareKey), view.version)}
          onClose={() => setReporting(false)}
          onDone={() => {
            setReporting(false);
            setSaid('신고를 보냈어요. 운영자가 확인할게요.');
            setAttempt((held) => held + 1);
          }}
        />
      )}
      <Divider label="" />
    </Screen>
  );
}
