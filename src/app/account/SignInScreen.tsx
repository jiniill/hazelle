import { LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Method } from '../../vault/keys';
import { ACTS } from '../common/acts';
import { useCredential } from '../common/useCredential';
import { LegalNotice } from '../common/LegalNotice';
import { useAttempt } from '../common/useAttempt';
import { Brand, Button, Callout, FileButton, IconButton, Intro, Screen, Stack, Text, TextField } from '../ui';

type Props = {
  // The account whose vault is locked on this device, or null when signed out.
  account: string | null;
  // Signed out: the username this browser last opened, or empty; solo: the one account of a one-person installation,
  // whose username is not asked.
  username?: string;
  solo?: boolean;
  notice?: string | null;
  // Signed out: the way back to this browser's guest, where 계정 만들기 is.
  onGuest?: () => void;
  onSubmit: (username: string, method: Method, secret: string) => Promise<string | null>;
  onLogout?: () => void;
};

// Signing in and unlocking are the same act: the password (or the recovery key) opens the vault.
export function SignInScreen({ account, username: known = '', solo = false, notice, onGuest, onSubmit, onLogout }: Props) {
  const [username, setUsername] = useState(known);
  const { busy, failure, run, setFailure } = useAttempt();
  const credential = useCredential(setFailure);
  const { method, secret, recovery } = credential;
  const verb = account ? '잠금 해제' : '로그인';

  const attempt = (text: string) => run(() => onSubmit(account ?? username, method, text));

  return (
    <Screen
      top={
        <>
          <Brand />
          {onLogout && <IconButton icon={LogOut} label="로그아웃" onClick={onLogout} />}
        </>
      }
      foot={<LegalNotice />}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void attempt(secret);
      }}
      actions={
        <>
          <Button type="submit" busy={busy}>
            {verb}
          </Button>
          <Button variant="ghost" onClick={credential.switchMethod}>
            {`${credential.alternate}로 ${verb}`}
          </Button>
          {onGuest && (
            <Button variant="ghost" onClick={onGuest}>
              손님으로 쓰기
            </Button>
          )}
        </>
      }
    >
      <Intro title={recovery ? `복구 키로 ${verb}` : verb}>
        {recovery
          ? '복구 키 파일을 선택하거나 키를 직접 입력해 주세요.'
          : account && `이 기기에서 ${account} 계정이 잠겼어요.`}
      </Intro>
      {notice && <Text variant="note">{notice}</Text>}
      <Stack>
        {!account && !solo && <TextField label="아이디" kind="username" value={username} onChange={setUsername} />}
        {recovery && (
          <FileButton accept=".txt,text/plain" icon={ACTS.import.icon} onFiles={([file]) => void file!.text().then(attempt)}>
            파일에서 {ACTS.import.label}
          </FileButton>
        )}
        <TextField {...credential.field} />
      </Stack>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
