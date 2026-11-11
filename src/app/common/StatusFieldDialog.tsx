import { useState } from 'react';
import type { StatusField } from '../../model/status';
import { nameTaken } from '../../engine/status';
import { addOf } from './acts';
import { draftField, draftProblems, fieldDraft, newDraft, type DraftProblem, type FieldDraft, type FieldKind } from './statusDraft';
import { STATUS_KIND, STATUS_PROBLEM, STATUS_TONE, STATUS_WORDS } from './statusWords';
import { Button, ChoiceGroup, Dialog, NumberInput, PhraseField, SettingGroup, SettingRow, Switch, TextField } from '../ui';
import { statusEdit, statusTaken } from './words';

type Props = {
  kind: FieldKind;
  // Absent for a new field.
  field?: StatusField;
  // The fields it stands among, whose names it may not take.
  among: readonly StatusField[];
  // A 기록's field: a row is written whole, so it has no start, no amount and no 대표.
  row: boolean;
  onSave: (field: StatusField) => void;
  onClose: () => void;
};

// One field's form, the inputs its kind takes. A problem is said by its input once saving was tried, a taken name at
// once: the writer would never reach the second of a name.
export function StatusFieldDialog({ kind, field, among, row, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<FieldDraft>(() => (field ? fieldDraft(field) : row ? { ...newDraft(kind), change: false } : newDraft(kind)));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<FieldDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const problems = tried ? draftProblems(kind, draft) : [];
  const said = (problem: DraftProblem) => (problems.includes(problem) ? STATUS_PROBLEM[problem] : undefined);
  const taken = nameTaken(among, draft.name, field?.id);
  const numeric = kind === 'gauge' || kind === 'number';
  const number = (label: string, key: 'min' | 'max' | 'start', problem: DraftProblem) => (
    <SettingRow label={label} error={said(problem)} control={<NumberInput label={label} value={draft[key]} invalid={said(problem) !== undefined} onChange={(value) => set({ [key]: value })} />} />
  );
  const flag = (label: string, key: 'change' | 'main' | 'checked', help: string) => <SettingRow label={label} help={help} control={<Switch label={label} checked={draft[key]} onChange={(on) => set({ [key]: on })} />} />;

  return (
    <Dialog
      title={field ? statusEdit(field.name) : `${STATUS_KIND[kind].label} ${addOf(STATUS_WORDS.field)}`}
      note={STATUS_KIND[kind].description}
      onClose={onClose}
      onSubmit={() => {
        const made = taken ? undefined : draftField(kind, field?.id ?? crypto.randomUUID(), draft, field);
        if (made) onSave(made);
        else setTried(true);
      }}
      actionsLayout="full"
      actions={<Button type="submit">저장</Button>}
    >
      <TextField label={STATUS_WORDS.name} value={draft.name} onChange={(name) => set({ name })} error={taken ? statusTaken(draft.name.trim()) : said('name')} />
      <SettingGroup label={STATUS_KIND[kind].label}>
        {kind === 'gauge' && number(STATUS_WORDS.min, 'min', 'range')}
        {kind === 'gauge' && number(STATUS_WORDS.max, 'max', 'range')}
        {numeric && !row && number(STATUS_WORDS.start, 'start', 'start')}
        {numeric && <SettingRow label={STATUS_WORDS.unit} control={<TextField label={STATUS_WORDS.unit} showLabel={false} value={draft.unit} onChange={(unit) => set({ unit })} />} />}
        {numeric && !row && flag(STATUS_WORDS.change, 'change', STATUS_WORDS.changeNote)}
        {kind === 'text' && !row && <SettingRow label={STATUS_WORDS.start} control={<TextField label={STATUS_WORDS.start} showLabel={false} value={draft.start} onChange={(start) => set({ start })} />} />}
        {kind === 'stage' && <SettingRow label={STATUS_WORDS.labels} wide error={said('labels')} control={<PhraseField label={STATUS_WORDS.labels} phrases={draft.labels} onChange={(labels) => set({ labels, start: labels.includes(draft.start) ? draft.start : '' })} />} />}
        {kind === 'stage' && !row && (
          <SettingRow
            label={STATUS_WORDS.start}
            control={<ChoiceGroup label={STATUS_WORDS.start} layout="menu" options={[{ value: '', label: STATUS_WORDS.startNone }, ...draft.labels.map((label) => ({ value: label, label }))]} value={draft.start} onChange={(start) => set({ start })} />}
          />
        )}
        {kind === 'list' && flag(STATUS_WORDS.checked, 'checked', STATUS_WORDS.checkedNote)}
        {!row && flag(STATUS_WORDS.main, 'main', STATUS_WORDS.mainNote)}
        <SettingRow label={STATUS_WORDS.tone} control={<ChoiceGroup label={STATUS_WORDS.tone} layout="fit" options={STATUS_TONE} value={draft.tone} onChange={(tone) => set({ tone })} />} />
      </SettingGroup>
    </Dialog>
  );
}
