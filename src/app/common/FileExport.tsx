import { useState } from 'react';
import { useToast } from '../toast';
import { Button, Callout, Dialog, Section, Text } from '../ui';
import { ACTS } from './acts';
import { runExport, type ExportWrite } from './exporting';
import { EXPORT } from './words';

type Props<T> = {
  format: string;
  file: string;
  // What the file leaves behind and where the other app opens it.
  help: string;
  // Why no file can be made, said in place of the 내보내기 that would make one the other app refuses.
  blocked: string | null;
  write: ExportWrite<T>;
  done: (data: T) => { message: string; detail?: string };
  onClose: () => void;
};

export function FileExport<T>({ format, file, help, blocked, write, done, onClose }: Props<T>) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // No await before runExport: the save picker needs the press's activation (common/exporting).
  const save = () => runExport(toast, file, write, setBusy, (data) => {
    const { message, detail } = done(data);
    toast.show(message, { detail });
    onClose();
  });
  return (
    <Dialog
      title={EXPORT}
      onClose={onClose}
      actions={
        <Button icon={ACTS.export.icon} busy={busy !== null} disabled={blocked !== null} onClick={save}>
          {busy ?? ACTS.export.label}
        </Button>
      }
    >
      <Section level={3} title={format} help={help}>
        {blocked === null ? <Text variant="note">{file}</Text> : <Callout tone="warn">{blocked}</Callout>}
      </Section>
    </Dialog>
  );
}
