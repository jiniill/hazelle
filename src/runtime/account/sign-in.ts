import { codeRequest, parseCode, parsePoll, pollRequest, type DeviceCode } from '../../connectors/device-code';
import type { SignIn } from '../../connectors/types';
import { noteStep } from '../diagnostics/auto-diagnosis';
import { pause } from '../pause';
import { relayJson, relayOAuth, type RelayFailure } from '../models/relay';

// refused carries the provider's OAuth error code, such as expired_token or access_denied.
export type SignInFailure = RelayFailure | { kind: 'bad-answer' } | { kind: 'refused'; code: string };
type Result<T> = ({ ok: true } & T) | { ok: false; failure: SignInFailure };

const noted = <T>(step: string, result: Result<T>): Result<T> => {
  noteStep(`sign-in:${result.ok ? step : result.failure.kind}`);
  return result;
};

export const requestCode = async (signIn: SignIn, signal: AbortSignal) => noted('code', await askCode(signIn, signal));

async function askCode(signIn: SignIn, signal: AbortSignal): Promise<Result<{ code: DeviceCode }>> {
  const answer = await relayOAuth(codeRequest(signIn), signal);
  if (!answer.ok) return answer;
  const code = parseCode(answer.data);
  return code ? { ok: true, code } : { ok: false, failure: { kind: 'bad-answer' } };
}

// Asks until the user approves on the provider's site, refuses, or the code runs out. A dropped
// connection only skips one round: a phone suspends the page while the user is away approving.
export const awaitApproval = async (signIn: SignIn, code: DeviceCode, signal: AbortSignal) => noted('approved', await approval(signIn, code, signal));

async function approval(signIn: SignIn, code: DeviceCode, signal: AbortSignal): Promise<Result<{ secret: string }>> {
  const deadline = Date.now() + code.expiresIn * 1000;
  let interval = code.interval;
  for (;;) {
    if (!(await pause(interval * 1000, signal))) return { ok: false, failure: { kind: 'stopped' } };
    if (Date.now() >= deadline) return { ok: false, failure: { kind: 'refused', code: 'expired_token' } };
    const answer = await relayOAuth(pollRequest(signIn, code.deviceCode), signal);
    if (!answer.ok) {
      if (answer.failure.kind === 'offline') continue;
      return answer;
    }
    const poll = parsePoll(answer.data);
    if (!poll) return { ok: false, failure: { kind: 'bad-answer' } };
    if (poll.state === 'done') return { ok: true, secret: poll.secret };
    if (poll.state === 'failed') return { ok: false, failure: { kind: 'refused', code: poll.code } };
    if (poll.state === 'slow-down') interval = poll.interval ?? interval + 5;
  }
}

export const accountName = async (signIn: SignIn, secret: string, signal: AbortSignal) => noted('account', await account(signIn, secret, signal));

async function account(signIn: SignIn, secret: string, signal: AbortSignal): Promise<Result<{ name: string }>> {
  const answer = await relayJson(signIn.account.request(secret), signal);
  if (!answer.ok) return answer;
  const name = signIn.account.parse(answer.data);
  return name ? { ok: true, name } : { ok: false, failure: { kind: 'bad-answer' } };
}
