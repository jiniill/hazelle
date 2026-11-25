import { useState } from 'react';
import type { SignIn } from '../../connectors/types';
import { Button, Disclosure, TextField } from '../ui';

// In place of the code: a token the person already signed in for elsewhere, so moving between apps needs no new sign-in.
export function TokenPaste({ signIn, onToken }: { signIn: SignIn; onToken: (token: string) => void }) {
  const [token, setToken] = useState('');
  const secret = token.trim();
  return (
    <Disclosure label="토큰으로 연결">
      <TextField
        label={`${signIn.site} 토큰`}
        kind="key"
        value={token}
        onChange={setToken}
        help={`다른 앱에서 ${signIn.site}에 로그인해 받은 OAuth 토큰을 붙여 넣어요.`}
        action={
          <Button size="sm" disabled={!secret} onClick={() => onToken(secret)}>
            연결
          </Button>
        }
      />
    </Disclosure>
  );
}
