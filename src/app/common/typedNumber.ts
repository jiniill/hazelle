
import { FIELD_ERRORS } from './words';export const count = (value: number) => value.toLocaleString('ko-KR');

export type Typed = { ok: true; value: number } | { ok: false; error: string };

// Bounds are each model's, so they are not checked here: a value past them is brought within them for that model, and
// the row says so.
export function readTyped(draft: string, whole: boolean): Typed {
  const value = Number(draft);
  if (draft.trim() === '' || !Number.isFinite(value)) return { ok: false, error: FIELD_ERRORS.number };
  if (whole && !Number.isSafeInteger(value)) return { ok: false, error: '정수를 입력해 주세요.' };
  return { ok: true, value };
}

// undefined: left empty. null: not a number.
export function readOptional(draft: string, whole: boolean): number | null | undefined {
  if (draft.trim() === '') return undefined;
  const typed = readTyped(draft, whole);
  return typed.ok ? typed.value : null;
}

// A field's reader: null for a text the field does not take, as error says.
export type Reader<V> = ((draft: string) => V | null) & { error: string };
export const reader = <V>(read: (draft: string) => V | null, error: string): Reader<V> => Object.assign(read, { error });

const readAtLeast = (least: number) => reader((draft) => {
  const typed = readTyped(draft, true);
  return typed.ok && typed.value >= least ? typed.value : null;
}, `${least} 이상의 정수를 입력해 주세요.`);

export const readCount = readAtLeast(1);
export const readWhole = readAtLeast(0);
