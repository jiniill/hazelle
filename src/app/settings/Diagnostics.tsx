import { Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { diagnosticReport } from '../../runtime/diagnostics';
import { ACTS } from '../common/acts';
import { BUILT_VERSION } from '../common/release';
import { useCopy } from '../common/useCopy';
import { Button, Row, SettingRow, Stack, TextField } from '../ui';

// 앱 정보's 문제 진단, what a 운영자에게만 post sends along (board/WriteScreen): run, read, then copy in a press of its own, since the check outlasts the press's activation.
export function Diagnostics() {
  const copy = useCopy();
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    void diagnosticReport(BUILT_VERSION).then(setReport).finally(() => setBusy(false));
  };
  return (
    <>
      <SettingRow
        label="문제 진단"
        help="게시판에서 운영자에게만 보낼 때 첨부되는 진단 정보를 보거나 복사해요. 기기·브라우저 정보와 이 탭의 최근 오류만 포함되며, 채팅 내용과 API 키는 빠져요."
        control={
          <Button variant="secondary" size="sm" icon={Stethoscope} busy={busy} onClick={run}>
            진단하기
          </Button>
        }
      />
      {report !== null && (
        <Stack gap="related">
          <TextField label="진단 정보" lines={10} value={report} onChange={() => {}} readOnly />
          <Row kind="actions">
            <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(report)}>
              {ACTS.copy.label}
            </Button>
          </Row>
        </Stack>
      )}
    </>
  );
}
