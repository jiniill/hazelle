import { useState } from 'react';
import type { Service } from '../../contracts/admin';
import { setService } from '../../runtime/admin';
import { selfHost } from '../../runtime/installation';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { count, readWhole } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, NumberInput, Section, SettingGroup, SettingRow, Text } from '../ui';
import { CAP_ERROR, capText, typedCap } from './bytes';

// The operator raises the cap in steps, so each cap sits with the count it bounds.
export function ServiceSection({ service, onSaved }: { service: Service; onSaved: () => void }) {
  // null: not typed in, so the field shows the server's value.
  const [seats, setSeats] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  const [fileCap, setFileCap] = useState<string | null>(null);
  const { busy, failure, run } = useAttempt();
  const signupCap = seats === null ? service.signupCap : readWhole(seats);
  const accountBytesCap = cap === null ? service.accountBytesCap : typedCap(cap);
  const accountFileBytesCap = fileCap === null ? service.accountFileBytesCap : typedCap(fileCap);
  const valid = signupCap !== null && accountBytesCap !== undefined && accountFileBytesCap !== undefined;
  const changed = signupCap !== service.signupCap || accountBytesCap !== service.accountBytesCap || accountFileBytesCap !== service.accountFileBytesCap;

  const save = () =>
    run(async () => {
      const saved = await setService({ signupCap: signupCap!, accountBytesCap: accountBytesCap!, accountFileBytesCap: accountFileBytesCap! });
      if (!saved.ok) return describeFailure(saved);
      setSeats(null);
      setCap(null);
      setFileCap(null);
      onSaved();
      return null;
    });

  return (
    <Section
      title="서비스"
      action={
        <Button variant="secondary" busy={busy} disabled={!valid || !changed} onClick={() => void save()}>
          저장
        </Button>
      }
    >
      <SettingGroup label="서비스">
        <SettingRow
          label="가입 정원"
          help="전체 계정 수가 정원보다 적을 때만 새로 가입할 수 있어요. 1명이면 혼자 쓰는 헤이젤이라 아이디 없이 비밀번호로만 로그인해요."
          sub={`지금 ${count(service.accounts)}명`}
          error={signupCap === null ? readWhole.error : undefined}
          control={<NumberInput label="가입 정원" unit="명" value={seats ?? String(service.signupCap)} invalid={signupCap === null} onChange={setSeats} />}
        />
        <SettingRow
          label="계정당 텍스트 한도"
          help="이미지를 제외한 계정별 저장 용량이에요."
          error={accountBytesCap === undefined ? CAP_ERROR : undefined}
          control={<NumberInput label="계정당 텍스트 한도" unit="MB" placeholder="없음" value={cap ?? capText(service.accountBytesCap)} invalid={accountBytesCap === undefined} onChange={setCap} />}
        />
        <SettingRow
          label="계정당 이미지 한도"
          help="계정마다 올린 이미지의 전체 용량이에요."
          sub={`저장된 이미지 합계 ${sizeText(service.fileBytes)}`}
          error={accountFileBytesCap === undefined ? CAP_ERROR : undefined}
          control={<NumberInput label="계정당 이미지 한도" unit="MB" placeholder="없음" value={fileCap ?? capText(service.accountFileBytesCap)} invalid={accountFileBytesCap === undefined} onChange={setFileCap} />}
        />
      </SettingGroup>
      <Text variant="note">{selfHost() ? `서비스 데이터베이스 ${sizeText(service.databaseBytes)}` : `서비스 데이터베이스 ${sizeText(service.databaseBytes)} · 공유 링크 ${count(service.links)}개`}</Text>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Section>
  );
}
