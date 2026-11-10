import { useEffect, useRef, useState } from 'react';
import { openVersion, sharedFile } from '../../runtime/export/share';
import { countReceived, readShareState } from '../../runtime/export/share-link';
import { describeFailure } from '../common/failure';
import { fileNamed } from '../common/download';
import { SHARE, THINGS } from '../common/words';
import { navigate } from '../shell/router';
import { HOME } from '../shell/routes';
import { useImport } from '../common/importing';
import { Callout, Progress, Screen } from '../ui';
import { clearPending, pendingFor } from '../common/sharePending';

// 헤이젤로 가져오기, after the page load and any sign-in: the link's charx, made here as 파일로 받기 makes it, goes in as a
// dropped file would, through the import's own questions and outcome.
export function ShareArrival({ id }: { id: string }) {
  const { bring } = useImport();
  const [step, setStep] = useState<{ done: number; total: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs a mount's effect twice; the key is taken once.
    if (started.current) return;
    started.current = true;
    const key = pendingFor(id);
    clearPending();
    void (async () => {
      if (key === null) return navigate(HOME, { replace: true });
      const state = await readShareState(id);
      if (!state.ok) return setFailure(describeFailure(state));
      if (state.data.state === 'held') return setFailure(SHARE.heldNote);
      if (state.data.state === 'gone') return setFailure(SHARE.goneNote);
      const source = { id, operator: false };
      const opened = await openVersion(source, state.data.manifest, key);
      if (!opened.ok) return setFailure(opened.error === 'unreadable' ? '링크를 열 수 없어요.' : describeFailure(opened));
      const file = await sharedFile(source, opened.data.content, fileNamed(opened.data.preview.name, THINGS.character.noun, 'charx'), setStep);
      if (!file.ok) return setFailure(describeFailure(file));
      navigate(HOME, { replace: true });
      if (await bring(file.data)) void countReceived(id);
    })();
  }, [id]);

  return (
    <Screen width="narrow" align="center">
      {failure ? (
        <Callout tone="warn" alert action={{ label: '홈으로', onClick: () => navigate(HOME, { replace: true }) }}>
          {failure}
        </Callout>
      ) : (
        <Progress hero title="링크에서 받는 중" steps={[{ label: '이미지', done: step?.done ?? 0, total: step?.total }]} />
      )}
    </Screen>
  );
}
