import { expect, it } from 'vitest';
import type { ModelSettings } from '../../connectors/settings';
import type { Stored } from '../../model/kinds';
import { followsRetries, NO_PROFILE_VALUES, profileLine } from './settingWords';

const profile = (id: string, name: string, settings: ModelSettings): Stored<'profile'> => ({ id, kind: 'profile', parent: null, rev: 1, value: { name, settings } });

it("reads a model's 모델 설정 by its values, naming it only when it is not the default, and says so when it is gone", () => {
  expect(profileLine({ kind: 'profile', profile: profile('a', '기본', { temperature: 1 }), own: false }, 'a')).toBe('온도 1');
  expect(profileLine({ kind: 'profile', profile: profile('b', 'Claude용', { temperature: 1, retries: 2 }), own: true }, 'a')).toBe('Claude용 · 온도 1 · 실패하면 다시 보내기 2번');
  expect(profileLine({ kind: 'profile', profile: profile('a', '기본', {}), own: false }, 'a')).toBe('지정 안 함');
  expect(profileLine({ kind: 'missing', own: true }, 'a')).toBe('모델 설정 없음');
});

it('names what is unset where no label beside the line says 모델 설정', () => {
  expect(profileLine({ kind: 'profile', profile: profile('a', '기본', {}), own: false }, 'a', NO_PROFILE_VALUES)).toBe('모델 원래 값');
  expect(profileLine({ kind: 'profile', profile: profile('a', '기본', { temperature: 1 }), own: false }, 'a', NO_PROFILE_VALUES)).toBe('온도 1');
});

it('names the layer an empty 실패하면 다시 보내기 follows', () => {
  expect(followsRetries('shared', 2)).toBe('공용 2번');
  expect(followsRetries('connection', 3)).toBe('연결 3번');
});
