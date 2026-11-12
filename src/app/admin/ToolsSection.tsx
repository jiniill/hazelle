import { FileX, Link2Off, Send } from 'lucide-react';
import { useState } from 'react';
import { sendNotice } from '../../runtime/service/admin';
import { TextDialog } from '../common/TextDialog';
import { NOTICES } from '../common/words';
import { useToast } from '../toast';
import { Button, Section, SettingGroup, SettingRow } from '../ui';
import { BlockFileDialog } from './BlockFileDialog';
import { HoldShareDialog } from './HoldShareDialog';
import { NOTICE_TEXT } from './notice';
import { ACTIONS } from './actions';

type Open = 'notice' | 'share' | 'file' | null;

export function ToolsSection({ onActed }: { onActed: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const done = () => {
    close();
    onActed();
  };
  return (
    <Section title="관리 도구">
      <SettingGroup label="관리 도구">
        <SettingRow
          label={`모두에게 ${NOTICES.send}`}
          help="현재 가입된 모든 계정에 알림을 보내요."
          control={<Button variant="secondary" size="sm" icon={Send} onClick={() => setOpen('notice')}>보내기</Button>}
        />
        <SettingRow
          label={ACTIONS['hold-share']}
          help="보류한 링크는 운영자가 해제할 때까지 열리지 않아요."
          control={<Button variant="secondary" size="sm" icon={Link2Off} onClick={() => setOpen('share')}>ID 입력</Button>}
        />
        <SettingRow
          label={ACTIONS['block-file']}
          help="차단한 파일은 어떤 계정에서도 올리거나 열 수 없어요."
          control={<Button variant="secondary" size="sm" icon={FileX} onClick={() => setOpen('file')}>ID 입력</Button>}
        />
      </SettingGroup>
      {open === 'notice' && (
        <TextDialog
          {...NOTICE_TEXT}
          title={`모두에게 ${NOTICES.send}`}
          label="보낼 내용"
          confirm={{ label: '보내기', icon: Send }}
          send={(text) => sendNotice(null, text)}
          onDone={() => {
            toast.show('모든 계정에 보냈어요.');
            done();
          }}
          onClose={close}
        />
      )}
      {open === 'share' && <HoldShareDialog onClose={close} onActed={done} />}
      {open === 'file' && <BlockFileDialog onClose={close} onActed={done} />}
    </Section>
  );
}
