import { CloudUpload, Eraser } from 'lucide-react';
import { useState } from 'react';
import { useAttempt } from '../common/useAttempt';
import { Brand, Button, Callout, ConfirmDialog, Intro, Screen } from '../ui';

type Props = {
  username: string;
  failure: string | null;
  onUpload: () => void;
  onDiscard: () => Promise<string | null>;
};

// Asked once, before the account opens (design §6.14): nothing a guest made is dropped without this answer.
export function GuestDataScreen({ username, failure, onUpload, onDiscard }: Props) {
  const [discarding, setDiscarding] = useState(false);
  const discard = useAttempt();
  const shown = discard.failure ?? failure;
  return (
    <Screen
      top={<Brand />}
      actions={
        <>
          <Button icon={CloudUpload} onClick={onUpload}>
            올리기
          </Button>
          <Button variant="ghost" onClick={() => setDiscarding(true)}>
            버리기
          </Button>
        </>
      }
    >
      <Intro title="계정에 올릴까요?">
        손님으로 만든 내용을 {username} 계정에 더해요. 설정은 계정 것을 그대로 써요.
      </Intro>
      {shown && (
        <Callout tone="warn" alert>
          {shown}
        </Callout>
      )}
      {discarding && (
        <ConfirmDialog
          title="손님으로 만든 내용 버리기"
          confirm="버리기"
          icon={Eraser}
          busy={discard.busy}
          onConfirm={() => void discard.run(onDiscard)}
          onClose={() => setDiscarding(false)}
        >
          버리면 되돌릴 수 없어요. 게시판에 쓴 글은 남고, 더는 고칠 수 없어요.
        </ConfirmDialog>
      )}
    </Screen>
  );
}
