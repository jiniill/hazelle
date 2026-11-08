import { PICTURE_PERCENT } from '../../model/library';
import { readOptional, reader } from './typedNumber';

// undefined: left empty. null: out of range.
export const readPicturePercent = reader((draft) => {
  const value = readOptional(draft, true);
  return typeof value === 'number' && (value < PICTURE_PERCENT.min || value > PICTURE_PERCENT.max) ? null : value;
}, `${PICTURE_PERCENT.min}부터 ${PICTURE_PERCENT.max} 사이의 값을 입력해 주세요.`);
