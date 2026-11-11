import { useState } from 'react';
import { statusAt, type StatusChange, type StatusField, type StatusValue } from '../../model/status';
import { STATUS_DONE, STATUS_RANGE } from '../common/words';
import { Button, Checkbox, ChoiceGroup, Dialog, NumberInput, PhraseField, SettingRow, Stack, Text, TextField, type ShownPlace } from '../ui';
import { draftOf, draftValue, itemDone, itemsOf, type StateDraft } from './stateEdit';
import type { ChatStateOf } from './useChatState';

type Props = {
  field: StatusField;
  value: StatusValue | undefined;
  // The record the field is of, when it is a 묶음's.
  of?: string;
  onSave: (value: StatusValue) => void;
  onClose: () => void;
};

function Control({ field, draft, onChange }: { field: StatusField; draft: StateDraft; onChange: (draft: StateDraft) => void }) {
  if (Array.isArray(draft)) {
    return (
      <Stack gap="group">
        <PhraseField label={field.name} phrases={draft.map(({ text }) => text)} onChange={(texts) => onChange(itemsOf(texts, draft))} />
        {field.kind === 'list' && field.checked && draft.length > 0 && (
          <Stack gap="related">
            <Text variant="note">{STATUS_DONE}</Text>
            {draft.map(({ text, done }) => (
              <Checkbox key={text} label={text} checked={done === true} onChange={(checked) => onChange(itemDone(draft, text, checked))} />
            ))}
          </Stack>
        )}
      </Stack>
    );
  }
  switch (field.kind) {
    case 'gauge':
    case 'number':
      return (
        <SettingRow
          label={field.name}
          note={field.kind === 'gauge' ? STATUS_RANGE(field.min, field.max) : undefined}
          control={<NumberInput label={field.name} unit={field.unit} value={draft} invalid={draftValue(field, draft) === undefined} onChange={onChange} />}
        />
      );
    case 'stage':
      return <ChoiceGroup label={field.name} showLabel={false} layout="list" options={field.labels.map((label) => ({ value: label, label }))} value={field.labels.includes(draft) ? draft : null} onChange={onChange} />;
    default:
      return <TextField label={field.name} showLabel={false} lines={3} focus="select" value={draft} onChange={onChange} />;
  }
}

// A value edited by hand (design §6.1 By hand): the control its kind takes, saved as a change over the writer's.
function StateEdit({ field, value, of, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => draftOf(field, value));
  const next = draftValue(field, draft);
  return (
    <Dialog
      title={field.name}
      note={of}
      onClose={onClose}
      onSubmit={() => next !== undefined && onSave(next)}
      actionsLayout="full"
      actions={
        <Button type="submit" disabled={next === undefined}>
          저장
        </Button>
      }
    >
      <Control field={field} draft={draft} onChange={setDraft} />
    </Dialog>
  );
}

// The editor of one place of a definition's state. Nothing once the field or its record is gone while it stood open.
export function StateEditAt({ state, place, onEdit, onClose }: { state: ChatStateOf; place: ShownPlace; onEdit: (change: StatusChange) => void; onClose: () => void }) {
  const at = statusAt(state.definition, state.now, place);
  if (!at) return null;
  return (
    <StateEdit
      field={at.field}
      value={at.values[at.field.id]}
      of={at.member?.name}
      onClose={onClose}
      onSave={(value) => {
        onEdit({ definition: state.definition.id, kind: 'set', ...place, value });
        onClose();
      }}
    />
  );
}
