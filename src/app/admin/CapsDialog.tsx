import { useState } from 'react';
import type { AdminAccount, OwnCap } from '../../contracts/admin';
import { setCaps } from '../../runtime/service/admin';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, ChoiceGroup, Dialog, NumberInput } from '../ui';
import { CAP_ERROR, capText, typedCap } from './bytes';
import { ACTIONS } from './actions';

type Choice = 'default' | 'none' | 'own';
type Draft = { choice: Choice; text: string };

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'default', label: '기본값' },
  { value: 'none', label: '없음' },
  { value: 'own', label: '직접 설정' },
];

const draftOf = (cap: OwnCap): Draft => (cap === 'default' ? { choice: 'default', text: '' } : cap === null ? { choice: 'none', text: '' } : { choice: 'own', text: capText(cap) });

// undefined: a size of its own that is not one, an empty field among them.
function capOf({ choice, text }: Draft): OwnCap | undefined {
  if (choice === 'default') return 'default';
  if (choice === 'none') return null;
  return text.trim() === '' ? undefined : typedCap(text);
}

function CapField({ label, draft, onChange }: { label: string; draft: Draft; onChange: (draft: Draft) => void }) {
  const invalid = capOf(draft) === undefined;
  return (
    <>
      <ChoiceGroup label={label} showLabel layout="fit" options={CHOICES} value={draft.choice} onChange={(choice) => onChange({ ...draft, choice })} />
      {draft.choice === 'own' && <NumberInput label={label} unit="MB" value={draft.text} invalid={invalid} onChange={(text) => onChange({ ...draft, text })} />}
      {draft.choice === 'own' && invalid && <Callout tone="warn">{CAP_ERROR}</Callout>}
    </>
  );
}

// One account's caps in place of the service's: 기본값 follows the service, 없음 lifts the cap.
export function CapsDialog({ account, onClose, onSaved }: { account: AdminAccount; onClose: () => void; onSaved: () => void }) {
  const [bytes, setBytes] = useState(() => draftOf(account.bytesCap));
  const [files, setFiles] = useState(() => draftOf(account.fileBytesCap));
  const { busy, failure, run } = useAttempt();
  const bytesCap = capOf(bytes);
  const fileBytesCap = capOf(files);
  const valid = bytesCap !== undefined && fileBytesCap !== undefined;

  const save = () =>
    run(async () => {
      const saved = await setCaps(account.accountId, { bytesCap: bytesCap!, fileBytesCap: fileBytesCap! });
      if (!saved.ok) return describeFailure(saved);
      onSaved();
      return null;
    });

  return (
    <Dialog
      title={`${account.username} ${ACTIONS['set-caps']}`}
      onClose={onClose}
      onSubmit={() => valid && void save()}
      actionsLayout="full"
      actions={
        <Button type="submit" busy={busy} disabled={!valid}>
          저장
        </Button>
      }
    >
      <CapField label="텍스트 한도" draft={bytes} onChange={setBytes} />
      <CapField label="이미지 한도" draft={files} onChange={setFiles} />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
