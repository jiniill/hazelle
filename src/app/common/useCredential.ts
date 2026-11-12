import { useState } from 'react';
import type { Method } from '../../vault/keys';
import { RECOVERY_KEY } from './words';

export function useCredential(setFailure: (failure: string | null) => void) {
  const [credential, setCredential] = useState<{ method: Method; secret: string }>({ method: 'password', secret: '' });
  const recovery = credential.method === 'recovery';
  return {
    ...credential,
    recovery,
    alternate: recovery ? '비밀번호' : RECOVERY_KEY,
    switchMethod: () => {
      setCredential(({ method }) => ({ method: method === 'password' ? 'recovery' : 'password', secret: '' }));
      setFailure(null);
    },
    field: {
      label: recovery ? RECOVERY_KEY : '비밀번호',
      kind: recovery ? 'code' as const : 'current-password' as const,
      placeholder: recovery ? 'XXXX-XXXX-XXXX-…' : undefined,
      value: credential.secret,
      onChange: (secret: string) => setCredential((current) => ({ ...current, secret })),
    },
  };
}
