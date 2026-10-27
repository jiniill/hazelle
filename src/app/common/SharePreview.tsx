import { useEffect, useState, type ReactNode } from 'react';
import type { Opened, ShareSource } from '../../runtime/share';
import { writeShared } from '../../runtime/share';
import { Button, Intro, Portrait, Row, Stack, Text } from '../ui';
import { ACTS } from './acts';
import { downloadOutput, fileNamed } from './download';
import { describeFailure } from './failure';
import { count } from './typedNumber';
import { SAVING_FILE, SHARE } from './words';

// Use the same charx export on public/operator previews; onDownloaded fires only after the whole file is written.
type Props = { source: ShareSource; opened: Opened; first?: ReactNode; received?: number; onDownloaded?: () => void; failed: (failure: string) => void };

export function SharePreview({ source, opened, first, received, onDownloaded, failed }: Props) {
  const { preview } = opened;
  const [face, setFace] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!preview.avatar) return;
    const url = URL.createObjectURL(preview.avatar);
    setFace(url);
    return () => URL.revokeObjectURL(url);
  }, [preview.avatar]);

  // The save picker opens before any await, inside the press that asked for it.
  function download() {
    const destination = downloadOutput(fileNamed(preview.name, '캐릭터', 'charx'));
    setBusy('받는 중');
    void (async () => {
      try {
        const written = await writeShared(source, opened.content, await destination, ({ done, total }) => setBusy(done < total ? `받는 중 · ${done} / ${total}` : `${SAVING_FILE} 중`));
        if (written.ok) onDownloaded?.();
        else failed(written.error === 'export-write' ? '파일을 저장하지 못했어요.' : describeFailure(written));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) failed('파일을 저장하지 못했어요.');
      } finally {
        setBusy(null);
      }
    })();
  }

  return (
    <Stack gap="group">
      <Portrait image={face} name={preview.name || '?'} />
      <Intro title={preview.name}>{[preview.creator && `제작자 ${preview.creator}`, received !== undefined && `${SHARE.received} ${count(received)}`].filter(Boolean).join(' · ')}</Intro>
      {preview.notes && <Text variant="prose">{preview.notes}</Text>}
      <Row kind="actions">
        {first}
        <Button variant="secondary" icon={ACTS.export.icon} busy={busy !== null} onClick={download}>
          {busy ?? SHARE.download}
        </Button>
      </Row>
    </Stack>
  );
}
