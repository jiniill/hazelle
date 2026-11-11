import type { StatusField, StatusItem, StatusValue } from '../../model/status';

// A value while it is edited by hand (design §6.1 By hand): a number as it is typed, a text, a 단계's label, or a
// list's items.
export type StateDraft = string | StatusItem[];

export function draftOf(field: StatusField, value: StatusValue | undefined): StateDraft {
  if (field.kind === 'list') return Array.isArray(value) ? value : [];
  return value === undefined || Array.isArray(value) ? '' : `${value}`;
}

// What a draft sets its field to. undefined while it is nothing the field takes: no number, a gauge's outside its
// range (said, never held to the range in silence), a label the 단계 does not have.
export function draftValue(field: StatusField, draft: StateDraft): StatusValue | undefined {
  switch (field.kind) {
    case 'gauge':
    case 'number': {
      const text = typeof draft === 'string' ? draft.trim().replaceAll(',', '') : '';
      const number = text === '' ? Number.NaN : Number(text);
      if (!Number.isFinite(number)) return undefined;
      return field.kind === 'gauge' && (number < field.min || number > field.max) ? undefined : number;
    }
    case 'text':
      return typeof draft === 'string' ? draft.trim() : undefined;
    case 'stage':
      return typeof draft === 'string' && field.labels.includes(draft) ? draft : undefined;
    case 'list':
      return Array.isArray(draft) ? draft : undefined;
  }
}

// A list's items once its texts were edited: an item that stays keeps whether it is done.
export const itemsOf = (texts: readonly string[], before: readonly StatusItem[]): StatusItem[] => texts.map((text) => before.find((item) => item.text === text) ?? { text });

export const itemDone = (items: readonly StatusItem[], text: string, done: boolean): StatusItem[] => items.map((item) => (item.text === text ? { text, ...(done && { done }) } : item));
