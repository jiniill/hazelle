import { History } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SELF_RESTORES_PER_DAY } from '../../contracts/admin';
import { exportBackup, readBackup, restoreBackup, type Backup, type BackupStep } from '../../runtime/backup';
import { ACTS, importOf } from '../common/acts';
import { downloadOutput } from '../common/download';
import { RestoresDialog } from '../common/RestoresDialog';
import { ACCOUNT_ONLY, SAVING_FILE, STOP } from '../common/words';
import { useToast } from '../toast';
import { useAccount, useSaves, useSession } from '../session';
import { Button, Dialog, FileButton, Panel, Progress, SettingGroup, SettingRow, type ProgressStep } from '../ui';
import { RisuExportRow } from './RisuExportRow';

const UNREAD: Record<'not-backup' | 'other-version' | 'backup-storage' | 'backup-crashed', { message: string; detail?: string }> = {
  'not-backup': { message: '헤이젤 백업 파일이 아니거나 손상된 파일이에요.' },
  'other-version': { message: '이전 버전에서 만든 백업이라 가져올 수 없어요.' },
  'backup-storage': { message: '백업을 준비하지 못했어요.', detail: '기기 저장 공간과 브라우저 저장 설정을 확인해 주세요.' },
  'backup-crashed': { message: '백업이 중간에 멈췄어요.', detail: '새로고침한 뒤 다시 시도해 주세요.' },
};

// sv-SE writes the local date as 2026-09-29.
const today = () => new Date().toLocaleDateString('sv-SE');

type Direction = 'save' | 'load';
type Steps = Partial<Record<BackupStep['kind'], BackupStep>>;
// In each job's order (runtime/backup-core): a save counts, then writes the objects while reading the pictures, then the
// browser finishes the file (Chrome copies and scans a picked file); a load reads the file, uploads
// the pictures, writes the objects, then their summaries. The first and last stages have no count of their own.
const STAGES: Record<Direction, { first: string; kinds: { kind: BackupStep['kind']; label: string }[]; last?: string }> = {
  save: { first: '집계', kinds: [{ kind: 'objects', label: '내용' }, { kind: 'files', label: '이미지' }], last: SAVING_FILE },
  load: { first: '백업 읽기', kinds: [{ kind: 'files', label: '이미지' }, { kind: 'objects', label: '내용' }, { kind: 'summaries', label: '요약' }] },
};
const TITLE: Record<Direction, string> = { save: '백업 내보내는 중', load: '백업 가져오는 중' };
const stages = (direction: Direction, steps: Steps): ProgressStep[] => [
  { label: STAGES[direction].first, finished: Object.keys(steps).length > 0 },
  ...STAGES[direction].kinds.map(({ kind, label }): ProgressStep => (steps[kind] ? { label, done: steps[kind].done, total: steps[kind].total } : { label })),
  ...(STAGES[direction].last ? [{ label: STAGES[direction].last }] : []),
];

export function BackupSection() {
  const { username, store, files } = useSession();
  const { guest } = useAccount();
  const saves = useSaves();
  const toast = useToast();
  const [active, setActive] = useState<{ direction: Direction; steps: Steps } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const running = useRef<{ abort: AbortController; release: () => void } | null>(null);
  useEffect(() => () => running.current?.abort.abort(), []);
  const stop = () => running.current?.abort.abort();

  // The job runs only while this screen does, and dies with the tab: the dialog keeps the person here and the hold has
  // the browser ask before the tab goes.
  function begin(direction: Direction) {
    const abort = new AbortController();
    running.current = { abort, release: saves.hold() };
    setActive({ direction, steps: {} });
    return { signal: abort.signal, progress: (step: BackupStep) => setActive((current) => ({ direction, steps: { ...current?.steps, [step.kind]: step } })) };
  }

  function end() {
    running.current?.release();
    running.current = null;
    setActive(null);
  }

  const unread = (error: keyof typeof UNREAD) => toast.error(UNREAD[error].message, { detail: UNREAD[error].detail });

  async function save() {
    const options = begin('save');
    try {
      const destination = downloadOutput(`hazelle-${username}-${today()}.zip`);
      const made = await exportBackup(store, files, await destination, options);
      if (!made.ok) {
        if (made.error === 'stopped') return;
        if (made.error === 'backup-crashed') return unread(made.error);
        if (made.error === 'backup-write') return toast.error('백업 파일을 저장하지 못했어요.', { detail: '저장 공간을 확인한 뒤 다시 시도해 주세요.' });
        return toast.failed(made, '백업을 만들지 못했어요.');
      }
      const { left, skipped } = made.data;
      const detail = [left ? `암호화 키로 열리지 않는 항목 ${left}개는 뺐어요.` : '', skipped ? `차단된 이미지 ${skipped}개는 뺐어요.` : ''].filter(Boolean).join(' ');
      toast.show('백업을 내보냈어요.', detail ? { detail } : undefined);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error('백업을 저장하지 못했어요.');
    } finally {
      end();
    }
  }

  async function load(file: File) {
    let backup: Backup | null = null;
    const options = begin('load');
    try {
      const read = await readBackup(file, options);
      if (!read.ok) {
        if (read.error !== 'stopped') unread(read.error);
        return;
      }
      backup = read.backup;
      const loaded = await restoreBackup(store, files, backup, options);
      if (loaded.ok) return toast.show('백업을 가져왔어요.', loaded.data.skipped ? { detail: `차단됐거나 너무 큰 이미지 ${loaded.data.skipped}개는 뺐어요.` } : undefined);
      if (loaded.error === 'not-new') return toast.error('백업은 새 계정에만 가져올 수 있어요.');
      if (loaded.error === 'not-backup' || loaded.error === 'backup-storage' || loaded.error === 'backup-crashed') return unread(loaded.error);
      if (loaded.error === 'stopped') return toast.show('가져오기를 멈췄어요.', { detail: '같은 파일로 이어서 가져올 수 있어요.' });
      toast.failed(loaded, '가져오지 못했어요. 같은 파일로 이어서 가져올 수 있어요.');
    } finally {
      await backup?.close();
      end();
    }
  }

  return (
    <Panel title="백업">
      <SettingGroup label="백업">
        <SettingRow
          label="전체 백업"
          help="API 키까지 포함해 암호화되지 않은 zip 파일로 내보내요."
          control={
            <Button variant="secondary" size="sm" icon={ACTS.export.icon} disabled={active !== null} onClick={() => void save()}>
              {ACTS.export.label}
            </Button>
          }
        />
        <RisuExportRow />
        <SettingRow
          label={importOf('백업')}
          help="새 계정에만 가져올 수 있어요."
          control={
            <FileButton accept=".zip" size="sm" icon={ACTS.import.icon} disabled={active !== null} onFiles={([file]) => void load(file!)}>
              {ACTS.import.label}
            </FileButton>
          }
        />
        {/* The server's history, which a guest has none of (design §6.14). */}
        <SettingRow
          label="이전 시점으로 복원"
          help={`10분 전부터 6일 전 사이의 기록으로 돌아가요. 하루에 ${SELF_RESTORES_PER_DAY}번까지 할 수 있어요.`}
          sub={guest ? ACCOUNT_ONLY : undefined}
          control={
            <Button variant="secondary" size="sm" icon={History} disabled={Boolean(guest)} onClick={() => setRestoring(true)}>
              복원
            </Button>
          }
        />
      </SettingGroup>
      {restoring && <RestoresDialog operated={null} onClose={() => setRestoring(false)} />}
      {active && (
        <Dialog title={TITLE[active.direction]} onClose={stop} actions={<Button variant="secondary" onClick={stop}>{STOP}</Button>}>
          <Progress hero steps={stages(active.direction, active.steps)} />
        </Dialog>
      )}
    </Panel>
  );
}
