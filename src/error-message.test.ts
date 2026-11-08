import { expect, it } from 'vitest';
import { errorMessage } from './error-message';

it("says an error's own message, and anything else thrown as written", () => {
  expect(errorMessage(new TypeError('끊겼어요'))).toBe('끊겼어요');
  expect(errorMessage('code:3: nil')).toBe('code:3: nil');
  expect(errorMessage(42)).toBe('42');
});
