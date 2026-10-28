import { expect, it } from 'vitest';
import { cannotRemove, portraitName, taskModelHelp } from './words';

it("opens a task's model where its help says it is chosen: the prompt with one, the prompts without", () => {
  expect(taskModelHelp('번역', true)).toEqual({ text: '번역 프롬프트에서 선택해요. 따로 선택하지 않으면 보조 모델을 사용해요.', door: '번역 프롬프트 열기' });
  expect(taskModelHelp('번역', false)).toEqual({ text: '번역 프롬프트에서 선택해요. 따로 선택하지 않으면 보조 모델을 사용해요.', door: '설정 › 프롬프트 열기' });
});

it('names a blank portrait as an unnamed person and says why a delete cannot run with the particle its reason takes', () => {
  expect(portraitName('  ')).toBe('이름 없는 인물');
  expect(portraitName('하루 ')).toBe('하루');
  expect(cannotRemove('기본 모델 설정')).toBe('기본 모델 설정이라서 삭제할 수 없어요');
  expect(cannotRemove('현재 페르소나')).toBe('현재 페르소나라서 삭제할 수 없어요');
});
