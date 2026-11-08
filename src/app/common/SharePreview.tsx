import { useEffect, useState, type ReactNode } from 'react';
import type { Opened, ShareSource } from '../../runtime/share';
import { writeShared } from '../../runtime/share';
import { Button, Intro, Portrait, Row, Stack, Text } from '../ui';
import { ACTS } from './acts';
import { fileNamed } from './download';
import { runExport } from './exporting';
import { describeFailure } from './failure';
import { count } from './typedNumber';
import { SHARE } from './words';

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

  const download = () =>
    runExport(
      { error: (message, extra) => failed([message, extra?.detail].filter(Boolean).join(' ')), failed: (failure) => failed(describeFailure(failure)) },
      fileNamed(preview.name, '캐릭터', 'charx'),
      (output, progress) => writeShared(source, opened.content, output, progress),
      setBusy,
      () => onDownloaded?.(),
      { doing: '받는 중' },
    );

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
