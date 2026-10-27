export const count = (value: number) => value.toLocaleString('ko-KR');

export type Typed = { ok: true; value: number } | { ok: false; error: string };

// Bounds are each model's, so they are not checked here: a value past them is brought within them for that model, and
// the row says so.
export function readTyped(draft: string, whole: boolean): Typed {
  const value = Number(draft);
  if (draft.trim() === '' || !Number.isFinite(value)) return { ok: false, error: '숫자를 입력해 주세요.' };
  if (whole && !Number.isSafeInteger(value)) return { ok: false, error: '정수를 입력해 주세요.' };
  return { ok: true, value };
}

// undefined: left empty. null: not a number.
export function readOptional(draft: string, whole: boolean): number | null | undefined {
  if (draft.trim() === '') return undefined;
  const typed = readTyped(draft, whole);
  return typed.ok ? typed.value : null;
}

// A whole number from least up; null: not one the field takes.
const readAtLeast = (least: number) => (draft: string): number | null => {
  const typed = readTyped(draft, true);
  return typed.ok && typed.value >= least ? typed.value : null;
};

export const readCount = readAtLeast(1);
export const readWhole = readAtLeast(0);
