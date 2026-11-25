import { expect, it } from 'vitest';
import { errorValue, failedTerminal, providerCode, providerMessage, streamError } from './errors';

it('reads decoded message strings verbatim and leaves unknown values to the transport', () => {
  expect(errorValue('Overloaded')).toBe('Overloaded');
  expect(errorValue({ message: 'Refused', code: 400 })).toBe('Refused');
  expect(errorValue({ code: 400 })).toBeNull();
  expect(streamError({ code: 400 })).toBe('{"code":400}');
  expect(streamError(undefined)).toBe('');
});

it('keeps HTTP top-level messages and raw-body fallback when nested values contain no message', () => {
  expect(providerMessage('{"error":{"message":"nested"},"message":"top"}')).toBe('nested');
  expect(providerMessage('{"error":"plain string"}')).toBe('plain string');
  expect(providerMessage('{"error":{"code":400},"message":"top"}')).toBe('top');
  expect(providerMessage('{"error":{"code":400},"detail":"detail"}')).toBe('detail');
  expect(providerMessage(' { "error": { "code": 400 } } ')).toBe('{ "error": { "code": 400 } }');
  expect(providerMessage(' error code: ' + 'x'.repeat(400))).toBe(('error code: ' + 'x'.repeat(400)).slice(0, 300));
});

it("reads a provider's word for its refusal: OpenAI's code, or Google's status beside its numeric code", () => {
  expect(providerCode('{"error":{"code":"insufficient_quota","message":"x"}}')).toBe('insufficient_quota');
  expect(providerCode('{"error":{"code":400,"message":"x","status":"INVALID_ARGUMENT"}}')).toBe('INVALID_ARGUMENT');
  expect(providerCode('{"error":{"code":400}}')).toBeNull();
  expect(failedTerminal({ code: 429, message: 'x', status: 'RESOURCE_EXHAUSTED' })).toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
});
