import { expect, it } from 'vitest';
import { cannotRemove, firstOf, portraitName } from './words';

it('names a blank portrait as an unnamed person and says why a delete cannot run with the particle its reason takes', () => {
  expect(portraitName('  ')).toBe('이름 없는 인물');
  expect(portraitName('하루 ')).toBe('하루');
  expect(cannotRemove('기본 모델 설정')).toBe('기본 모델 설정이라서 삭제할 수 없어요');
  expect(cannotRemove('현재 페르소나')).toBe('현재 페르소나라서 삭제할 수 없어요');
});

it('names the first few of a run and counts the rest, saying nothing more of a run that fits', () => {
  expect(firstOf(['가', '나', '다'], 2)).toBe('가, 나 외 1개');
  expect(firstOf(['가', '나'], 2)).toBe('가, 나');
});
