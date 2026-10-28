import { ChevronLeft } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAttempt } from '../common/useAttempt';
import { Brand, Button, Callout, IconButton, Intro, Screen, Stack, Steps, TextField } from '../ui';

const MIN_LENGTH = 8;

type Props = {
  // reset: after the recovery key opened the vault, a new password is required. setup: the one account of a one-person
  // installation, which takes no username.
  mode: 'signup' | 'setup' | 'reset';
  username: string;
  // signup: back to the guest it started from, and the way for someone who already has an account.
  onBack?: () => void;
  onSignIn?: () => void;
  onDone: (username: string, password: string) => Promise<string | null>;
};

// The server never sees the password, so its rules are checked here and nowhere else.
export function PasswordScreen({ mode, username: initialUsername, onBack, onSignIn, onDone }: Props) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const { busy, failure, run, setFailure } = useAttempt();
  const signup = mode !== 'reset';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ([...password].length < MIN_LENGTH) return setFailure(`비밀번호는 ${MIN_LENGTH}자 이상으로 입력해 주세요.`);
    if (password !== again) return setFailure('입력한 두 비밀번호가 서로 달라요.');
    await run(() => onDone(username, password));
  }

  return (
    <Screen
      top={onBack ? <IconButton icon={ChevronLeft} label="이전" onClick={onBack} /> : <Brand />}
      onSubmit={submit}
      actions={
        <>
          <Button type="submit" busy={busy}>
            {signup ? '다음' : '저장'}
          </Button>
          {onSignIn && (
            <Button variant="ghost" onClick={onSignIn}>
              계정이 있으면 로그인
            </Button>
          )}
        </>
      }
    >
      {signup && <Steps current={1} total={2} />}
      <Intro title={{ signup: '계정 만들기', setup: '비밀번호 설정', reset: '새 비밀번호 설정' }[mode]}>
        {{
          signup: '비밀번호는 서버로 전송되지 않아요.',
          setup: '이 헤이젤을 열 때 쓰는 비밀번호예요.',
          reset: '새 비밀번호를 입력해 주세요.',
        }[mode]}
      </Intro>
      <Stack>
        {mode === 'signup' && <TextField label="아이디" kind="username" value={username} onChange={setUsername} />}
        <TextField label="비밀번호" kind="new-password" value={password} onChange={setPassword} placeholder="8자 이상" />
        <TextField label="비밀번호 확인" kind="new-password" value={again} onChange={setAgain} placeholder="비밀번호 다시 입력" />
      </Stack>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
