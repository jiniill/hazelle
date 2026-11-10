import { useEffect, useState } from 'react';
import type { DeviceCode } from '../../connectors/device-code';
import type { SignIn } from '../../connectors/types';
import { accountName, awaitApproval, requestCode } from '../../runtime/account/sign-in';
import { describeSignInFailure } from '../common/failure';
import { useToast } from '../toast';

type SignInStage = { step: 'starting' } | { step: 'code'; code: DeviceCode } | { step: 'connecting' } | { step: 'failed'; message: string };

// The device flow from its code to the signed-in account. approved answers a failure in words, or null.
// attempt: a new value starts it again.
export function useDeviceSignIn(signIn: SignIn, attempt: number, approved: (secret: string, name: string, signal: AbortSignal) => Promise<string | null>) {
  const toast = useToast();
  const [stage, setStage] = useState<SignInStage>({ step: 'starting' });

  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    const fail = (message: string) => signal.aborted || setStage({ step: 'failed', message });
    setStage({ step: 'starting' });
    void (async () => {
      const started = await requestCode(signIn, signal);
      if (!started.ok) return fail(describeSignInFailure(started.failure, signIn.site));
      setStage({ step: 'code', code: started.code });
      const token = await awaitApproval(signIn, started.code, signal);
      if (!token.ok) return fail(describeSignInFailure(token.failure, signIn.site));
      setStage({ step: 'connecting' });
      const account = await accountName(signIn, token.secret, signal);
      if (!account.ok) return fail(describeSignInFailure(account.failure, signIn.site));
      const failure = await approved(token.secret, account.name, signal);
      if (failure) fail(failure);
    })();
    return () => abort.abort();
    // approved is the caller's closure, new each render; signIn and attempt say when to start again.
  }, [signIn, attempt]);

  // The copy starts before the new tab takes focus, which the clipboard needs.
  function openSite(code: DeviceCode) {
    navigator.clipboard.writeText(code.userCode).then(
      () => toast.show('코드를 복사했어요.'),
      () => {},
    );
    window.open(code.verificationUri, '_blank', 'noopener');
  }

  return { stage, openSite };
}
