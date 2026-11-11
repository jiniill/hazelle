import type { StatusField, StatusTone } from '../../model/status';

// A field while its form is filled in: numbers as they are typed, every kind's options side by side so switching what
// is shown loses nothing typed.
export type FieldDraft = { name: string; min: string; max: string; start: string; unit: string; change: boolean; main: boolean; tone: Tone; labels: string[]; checked: boolean };

// '' is the 분위기's accent, which a field with no tone is drawn in.
type Tone = Exclude<StatusTone, 'accent'> | '';

export type FieldKind = StatusField['kind'];

const BLANK: FieldDraft = { name: '', min: '0', max: '100', start: '', unit: '', change: false, main: false, tone: '', labels: [], checked: false };

// A new field's form: a gauge and a number start as ones the writer moves, the commoner ask.
export const newDraft = (kind: FieldKind): FieldDraft => ({ ...BLANK, change: kind === 'gauge' || kind === 'number' });

export function fieldDraft(field: StatusField): FieldDraft {
  const drawn = { name: field.name, main: field.main === true, tone: field.tone === undefined || field.tone === 'accent' ? ('' as const) : field.tone };
  switch (field.kind) {
    case 'gauge':
      return { ...BLANK, ...drawn, min: `${field.min}`, max: `${field.max}`, start: field.start === undefined ? '' : `${field.start}`, unit: field.unit ?? '', change: field.change === true };
    case 'number':
      return { ...BLANK, ...drawn, start: field.start === undefined ? '' : `${field.start}`, unit: field.unit ?? '', change: field.change === true };
    case 'text':
      return { ...BLANK, ...drawn, start: field.start ?? '' };
    case 'stage':
      return { ...BLANK, ...drawn, labels: field.labels, start: field.start ?? '' };
    case 'list':
      return { ...BLANK, ...drawn, checked: field.checked === true };
  }
}

const numberOf = (text: string): number | undefined => {
  const trimmed = text.trim().replaceAll(',', '');
  const number = trimmed === '' ? Number.NaN : Number(trimmed);
  return Number.isFinite(number) ? number : undefined;
};

// What stops a form from being a field, by the input it is about; none once it can be saved. A blank start is no
// start: the field is then not set until its writer sets it.
export type DraftProblem = 'name' | 'range' | 'start' | 'labels';
export function draftProblems(kind: FieldKind, draft: FieldDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.name.trim()) problems.push('name');
  const start = draft.start.trim();
  if (kind === 'gauge') {
    const min = numberOf(draft.min);
    const max = numberOf(draft.max);
    if (min === undefined || max === undefined || min >= max) problems.push('range');
    else if (start !== '' && (numberOf(start) === undefined || numberOf(start)! < min || numberOf(start)! > max)) problems.push('start');
  }
  if (kind === 'number' && start !== '' && numberOf(start) === undefined) problems.push('start');
  if (kind === 'stage') {
    if (draft.labels.length < 2) problems.push('labels');
    else if (start !== '' && !draft.labels.includes(start)) problems.push('start');
  }
  return problems;
}

// The field a form makes, under the id it keeps. undefined while the form has a problem. A list keeps the start it
// had: its items are not part of the form.
export function draftField(kind: FieldKind, id: string, draft: FieldDraft, before?: StatusField): StatusField | undefined {
  if (draftProblems(kind, draft).length) return undefined;
  const named = { id, name: draft.name.trim(), ...(draft.main && { main: true as const }), ...(draft.tone && { tone: draft.tone }) };
  const start = draft.start.trim();
  const numeric = { ...(start !== '' && { start: numberOf(start)! }), ...(draft.change && { change: true as const }), ...(draft.unit.trim() && { unit: draft.unit.trim() }) };
  switch (kind) {
    case 'gauge':
      return { ...named, kind, min: numberOf(draft.min)!, max: numberOf(draft.max)!, ...numeric };
    case 'number':
      return { ...named, kind, ...numeric };
    case 'text':
      return { ...named, kind, ...(start !== '' && { start }) };
    case 'stage':
      return { ...named, kind, labels: draft.labels, ...(start !== '' && { start }) };
    case 'list':
      return { ...named, kind, ...(draft.checked && { checked: true as const }), ...(before?.kind === 'list' && before.start && { start: before.start }) };
  }
}
