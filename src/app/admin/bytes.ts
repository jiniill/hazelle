import { MB } from '../common/size';

// The cap as the field shows it: '' is no cap.
export const capText = (bytes: number | null) => (bytes === null ? '' : String(bytes / MB));

export const CAP_ERROR = '0 이상의 숫자를 MB 단위로 입력해 주세요.';

// The cap typed in MB, in bytes: null for an empty field, which is no cap; undefined for what is not a size.
export function typedCap(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const bytes = Math.round(Number(trimmed) * MB);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
}
