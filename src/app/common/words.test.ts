import { expect, it } from 'vitest';
import { cannotRemove, portraitName } from './words';

it('names a blank portrait as an unnamed person and says why a delete cannot run with the particle its reason takes', () => {
  expect(portraitName('  ')).toBe('이름 없는 인물');
  expect(portraitName('하루 ')).toBe('하루');
  expect(cannotRemove('기본 모델 설정')).toBe('기본 모델 설정이라서 삭제할 수 없어요');
  expect(cannotRemove('현재 페르소나')).toBe('현재 페르소나라서 삭제할 수 없어요');
});
