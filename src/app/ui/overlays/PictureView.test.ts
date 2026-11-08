import { expect, it } from 'vitest';
import { pressed } from '../foundation/keys';
import { ZOOM_KEYS } from './PictureView';

const press = (key: string, code: string, ctrlKey = false) => ({ key, code, shiftKey: false, ctrlKey, metaKey: false, altKey: false, nativeEvent: { isComposing: false, keyCode: 0 } });

it('takes Z in any input mode for 확대, and leaves Ctrl+Z to undo', () => {
  expect(pressed(press('z', 'KeyZ'), ZOOM_KEYS.keys)).toBe(true);
  expect(pressed(press('ㅋ', 'KeyZ'), ZOOM_KEYS.keys)).toBe(true);
  expect(pressed(press('z', 'KeyZ', true), ZOOM_KEYS.keys)).toBe(false);
});
