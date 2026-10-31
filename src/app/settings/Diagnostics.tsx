import { Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { stateFacts } from '../../runtime/diagnostic-state';
import { diagnosticReport, lastPlace } from '../../runtime/diagnostics';
import { ACTS } from '../common/acts';
import { BUILT_VERSION } from '../../runtime/installation';
import { DIAGNOSIS_NOTE } from '../common/words';
import { useCopy } from '../common/useCopy';
import { useSession } from '../session';
import { Button, Row, SettingRow, Stack, TextField } from '../ui';

// 앱 정보's 문제 진단, what a 운영자에게만 post sends along (board/WriteScreen): run, read, then copy in a press of its own, since the check outlasts the press's activation.
export function Diagnostics() {
  const copy = useCopy();
  const session = useSession();
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    void diagnosticReport(BUILT_VERSION, stateFacts(session, lastPlace())).then(setReport).finally(() => setBusy(false));
  };
  return (
    <>
      <SettingRow
        label="문제 진단"
        help={DIAGNOSIS_NOTE}
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
