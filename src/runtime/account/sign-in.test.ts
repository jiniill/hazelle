import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copilot } from '../../connectors/copilot';
import type { DeviceCode } from '../../connectors/device-code';
import { awaitApproval, requestCode } from './sign-in';
import { inTurn, stubRelay, upstream } from '../testing';

const signIn = copilot.signIn!;
const code: DeviceCode = { deviceCode: 'dc', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 };

// GitHub through the relay: each request gets the next status and body, or null for a dropped connection.
const github = (answers: ([number, unknown] | null)[]) => stubRelay(inTurn(answers.map((answer) => answer && upstream(...answer))));
const times = (log: { at: number }[]) => log.map((call) => call.at);

async function approval(device = code, signal = new AbortController().signal) {
  const result = awaitApproval(signIn, device, signal);
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sign-in', () => {
  it('gets a code to show', async () => {
    github([[200, { device_code: 'dc', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }]]);
    expect(await requestCode(signIn, new AbortController().signal)).toEqual({ ok: true, code });
  });

  it('waits through "not yet", slows down when told, and rides over a dropped connection', async () => {
    const log = github([[400, { error: 'authorization_pending' }], [200, { error: 'slow_down', interval: 10 }], null, [200, { access_token: 'gho_x' }]]);
    expect(await approval()).toEqual({ ok: true, secret: 'gho_x' });
    expect(times(log)).toEqual([5, 10, 20, 30]);
  });

  it('gives up when the code runs out or the user refuses', async () => {
    const log = github([[200, { error: 'authorization_pending' }], [200, { error: 'authorization_pending' }]]);
    expect(await approval({ ...code, expiresIn: 12 })).toEqual({ ok: false, failure: { kind: 'refused', code: 'expired_token' } });
    expect(times(log)).toEqual([5, 10]);
    github([[200, { error: 'access_denied' }]]);
    expect(await approval()).toEqual({ ok: false, failure: { kind: 'refused', code: 'access_denied' } });
  });

  it('stops asking once the screen is left', async () => {
    const log = github([]);
    const abort = new AbortController();
    const result = approval(code, abort.signal);
    abort.abort();
    expect(await result).toEqual({ ok: false, failure: { kind: 'stopped' } });
    expect(log).toEqual([]);
  });
});
