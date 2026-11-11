import type { StatusDefinition, StatusField, StatusOf, StatusValue, StatusValues } from '../../model/status';
import { STATUS_WORDS } from './statusWords';

const SAMPLE = STATUS_WORDS.sample;

// A field's start, or a value of its kind standing in for one: a gauge at the middle of its range, a 단계 at its first.
function sampleValue(field: StatusField): StatusValue {
  if (field.start !== undefined) return field.start;
  switch (field.kind) {
    case 'gauge':
      return Math.round((field.min + field.max) / 2);
    case 'number':
      return 0;
    case 'text':
      return SAMPLE;
    case 'stage':
      return field.labels[0]!;
    case 'list':
      return [{ text: `${SAMPLE} 1`, ...(field.checked && { done: true as const }) }, { text: `${SAMPLE} 2` }];
  }
}

// A state that fills everything a definition declares, for its editor's preview: no chat holds it. A 묶음 with no
// record of its own gets one, and each 기록 one row.
export function sampleState(definition: StatusDefinition): StatusOf {
  const values = (fields: readonly StatusField[]): StatusValues => Object.fromEntries(fields.map((field) => [field.id, sampleValue(field)]));
  return {
    values: values(definition.fields),
    groups: Object.fromEntries(definition.groups.map(({ id, fields, members }) => [id, (members.length ? members : [{ id: 'sample', name: SAMPLE }]).map((member) => ({ ...member, values: values(fields) }))])),
    logs: Object.fromEntries(definition.logs.map(({ id, fields }) => [id, [values(fields)]])),
  };
}
