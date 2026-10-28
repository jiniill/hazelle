import { UserX } from 'lucide-react';
import { useState } from 'react';
import { credentialFor, deleteAccount } from '../../runtime/account';
import { describeFailure, wrongSecret } from '../common/failure';
import { useCredential } from '../common/useCredential';
import { useAttempt } from '../common/useAttempt';
import { useSignedIn, useSession } from '../session';
import { Button, ConfirmDialog, Panel, SettingGroup, SettingRow, Stack, TextField } from '../ui';

export function LeaveSection() {
  const [asking, setAsking] = useState(false);
  return (
    <Panel title="탈퇴">
      <SettingGroup label="탈퇴">
        <SettingRow
          label="계정 삭제"
          help="되돌릴 수 없어요. 전체 백업을 미리 내보내 두세요."
          control={
            <Button variant="danger" size="sm" icon={UserX} onClick={() => setAsking(true)}>
              탈퇴
            </Button>
          }
        />
      </SettingGroup>
      {asking && <LeaveDialog onClose={() => setAsking(false)} />}
    </Panel>
  );
}

function LeaveDialog({ onClose }: { onClose: () => void }) {
  const { username } = useSession();
  const { onLogout } = useSignedIn();
  const { busy, failure, run, setFailure } = useAttempt();
  const credential = useCredential(setFailure);
  const { method, secret } = credential;

  const leave = () =>
    run(async () => {
      const login = await credentialFor(username, method, secret);
      if (!login) return wrongSecret(method, false);
      const left = await deleteAccount(login);
      if (!left.ok) return left.error === 'wrong-login' ? wrongSecret(method, false) : describeFailure(left);
      return onLogout();
    });

  return (
    <ConfirmDialog
      title="탈퇴할까요?"
      confirm="탈퇴"
      icon={UserX}
      busy={busy}
      onConfirm={() => void leave()}
      onClose={onClose}
      field={
        <Stack gap="related">
          <TextField {...credential.field} error={failure ?? undefined} />
          <Button variant="link" size="xs" onClick={credential.switchMethod}>
            {`${credential.alternate}로 확인`}
          </Button>
        </Stack>
      }
    >
      이 계정의 모든 데이터를 서버에서 삭제해요. 되돌릴 수 없어요. 게시판에 쓴 글과 댓글, 신고, 운영자 기록은 남아요.
    </ConfirmDialog>
  );
}
