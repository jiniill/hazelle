import { useState } from 'react';
import type { BackupCopyFailure, BackupFolder } from '../../contracts/admin';
import { setBackupFolder } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { REPOSITORY } from '../common/legal';
import { moment } from '../common/time';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, Link, Section, Text, TextField } from '../ui';

const FAILURES: Record<BackupCopyFailure, string> = {
  missing: '폴더를 찾지 못해서 복사하지 못했어요. 드라이브가 연결돼 있는지 확인해 주세요.',
  denied: '폴더에 쓸 권한이 없어서 복사하지 못했어요.',
  full: '폴더가 있는 디스크가 꽉 차서 복사하지 못했어요.',
  failed: '폴더에 복사하지 못했어요.',
};

const HOUR_MS = 60 * 60 * 1000;

// A self-host's copy of every backup generation (server/backup/folder.ts). backupAgeHours dates the newest copied one.
export function BackupFolderSection({ folder, backupAgeHours, onSaved }: { folder: BackupFolder; backupAgeHours: number | null; onSaved: () => void }) {
  // null: not typed in, so the field shows the saved folder.
  const [typed, setTyped] = useState<string | null>(null);
  const { busy, failure, run } = useAttempt();
  const value = typed ?? folder.path ?? '';
  const next = value.trim() || null;

  const save = () =>
    run(async () => {
      const saved = await setBackupFolder(next);
      if (!saved.ok) return describeFailure(saved);
      setTyped(null);
      onSaved();
      return null;
    });

  return (
    <Section
      title="백업"
      action={
        <Button variant="secondary" busy={busy} disabled={next === folder.path} onClick={() => void save()}>
          저장
        </Button>
      }
    >
      <TextField
        label="백업 폴더"
        help="매일 생성되는 백업을 이 폴더에도 복사해요. 디스크가 고장 나도 백업이 남도록 USB나 외장 드라이브, OneDrive 같은 동기화 폴더를 지정해 주세요."
        value={value}
        onChange={setTyped}
        placeholder="예: D:\헤이젤 백업"
      />
      {folder.failure ? (
        <Callout tone="warn">{FAILURES[folder.failure]}</Callout>
      ) : (
        <Text variant="note">
          {folder.path === null
            ? '폴더를 지정하지 않으면 백업이 이 컴퓨터 디스크에만 저장돼요.'
            : backupAgeHours === null
              ? '아직 복사한 백업이 없어요.'
              : `복사한 최신 백업: ${moment(Date.now() - backupAgeHours * HOUR_MS)}`}
        </Text>
      )}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Section>
  );
}

// A Docker self-host's copies are its rclone copier's (README "Backups"), which this server sees only by what it copied.
export function BackupCopierNote() {
  return (
    <Section title="백업">
      <Text variant="note">
        백업이 이 컴퓨터의 디스크에만 있어요. 다른 곳으로 복사하는 방법은 <Link href={`${REPOSITORY}#backups`}>README의 백업 안내</Link>에 있어요.
      </Text>
    </Section>
  );
}
