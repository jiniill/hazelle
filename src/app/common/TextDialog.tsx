import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ApiResult } from '../../runtime/api';
import { describeFailure } from './failure';
import { count } from './typedNumber';
import { useAttempt } from './useAttempt';
import { Button, Callout, Dialog, TextField } from '../ui';

// A text field's count against its limit, and the error once past it. Counted as the server counts: trimmed.
export function counted(text: string, max: number) {
  const length = text.trim().length;
  const over = length > max;
  return { length, over, hint: `${count(length)} / ${count(max)}자`, error: over ? `${count(max)}자까지 쓸 수 있어요.` : undefined };
}

type Props = {
  title: string;
  note?: string;
  label: string;
  lines: number;
  placeholder?: string;
  help?: string;
  max: number;
  // tooLong: the error past max in place of counted's. quiet: no count and no error under the field; past max only the
  // button stops.
  tooLong?: string;
  quiet?: boolean;
  confirm: { label: string; icon: LucideIcon };
  cancel?: boolean;
  above?: ReactNode;
  below?: ReactNode;
  ready?: boolean;
  // trim: send the text trimmed, as it is counted; otherwise as typed.
  trim?: boolean;
  send: (text: string) => Promise<ApiResult<undefined>>;
  onDone: () => void;
  onClose: () => void;
};

export function TextDialog({ title, note, label, lines, placeholder, help, max, tooLong, quiet = false, confirm, cancel = false, above, below, ready = true, trim = false, send, onDone, onClose }: Props) {
  const [text, setText] = useState('');
  const { busy, failure, run } = useAttempt();
  const { length, over, hint, error } = counted(text, max);
  const submit = () =>
    run(async () => {
      const sent = await send(trim ? text.trim() : text);
      if (!sent.ok) return describeFailure(sent);
      onDone();
      return null;
    });
  return (
    <Dialog
      title={title}
      note={note}
      onClose={onClose}
      onSubmit={() => void submit()}
      actions={
        <>
          {cancel && (
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
          )}
          <Button type="submit" icon={confirm.icon} busy={busy} disabled={length === 0 || over || !ready}>
            {confirm.label}
          </Button>
        </>
      }
    >
      {above}
      <TextField
        label={label}
        lines={lines}
        value={text}
        onChange={setText}
        placeholder={placeholder}
        help={help}
        hint={quiet ? undefined : hint}
        error={quiet || !over ? undefined : (tooLong ?? error)}
      />
      {below}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
