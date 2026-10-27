import { useState, type ReactNode } from 'react';
import type { MemorySettings } from '../../model/memory';
import { typedText } from './typed';
import { readCount } from './typedNumber';
import { MODEL_ROLES } from './words';
import { Breakdown, Disclosure, NumberInput, SettingGroup, SettingRow, Switch } from '../ui';

type Count = 'budget' | 'window' | 'batch';

const COUNTS: Record<Count, { label: string; unit: string; help?: string }> = {
  budget: { label: '기록 최대 분량', unit: '토큰', help: `정리한 기록을 요청할 때마다 최대 이만큼 넣어요. ${MODEL_ROLES.embed}로 찾아서 넣는 기록은 이 한도 밖에서 최대 1/5까지 더 들어가요.` },
  window: { label: '원문으로 보낼 최근 대화', unit: '토큰' },
  batch: { label: '한 번에 정리할 분량', unit: '토큰', help: '오래된 대화가 이만큼 쌓이면 기록으로 정리해요.' },
};

export const settingsOf = ({ on, budget, window, batch }: MemorySettings): MemorySettings => ({ on, budget, window, batch });

type Part = { tokens: number; value: string };

// Match request order: memory, retrieval, waiting messages, raw window.
// found is known only after a request; whole is the denominator for every bar segment.
export function MemorySplit({ total, whole, records, found, waiting, recent }: { total?: { label: string; value: string }; whole: number; records: Part; found?: Part; waiting: Part; recent: Part }) {
  const parts = [
    { ...records, label: '기록', mark: 'accent' as const },
    ...(found ? [{ ...found, label: `${MODEL_ROLES.embed}로 찾는 기록`, mark: 'outline' as const }] : []),
    { ...waiting, label: '정리를 기다리는 대화', mark: 'striped' as const },
    { ...recent, label: COUNTS.window.label, mark: 'plain' as const },
  ];
  return <Breakdown total={total} shares={parts.map((part) => part.tokens / whole)} parts={parts.map(({ label, value, mark }) => ({ label, value, mark }))} />;
}

const MEMORY_HELP = '오래된 대화를 기록으로 정리해서 모델에게 보내요.';

type Props = {
  value: MemorySettings;
  onChange: (change: Partial<MemorySettings>) => void;
  // 사용's ⓘ, MEMORY_HELP by default.
  help?: string;
  // Between 사용 and 세부 설정.
  children?: ReactNode;
};

// A number is passed on only once it is valid. A caller that resets the values from outside remounts this, so a number
// typed and not valid does not stand over the reset.
export function MemoryFields({ value, onChange, help: usage = MEMORY_HELP, children }: Props) {
  const [drafts, setDrafts] = useState<Partial<Record<Count, string>>>({});
  const row = (field: Count) => {
    const { label, unit, help } = COUNTS[field];
    const draft = typedText(drafts[field], readCount, value[field], String);
    const invalid = readCount(draft) === null;
    const type = (next: string) => {
      setDrafts((current) => ({ ...current, [field]: next }));
      const count = readCount(next);
      if (count !== null) onChange({ [field]: count });
    };
    return (
      <SettingRow
        key={field}
        label={label}
        help={help}
        error={invalid ? '1 이상의 정수를 입력해 주세요.' : undefined}
        control={<NumberInput label={label} unit={unit} value={draft} invalid={invalid} onChange={type} />}
      />
    );
  };
  const rows = [row('budget'), row('window'), row('batch')];
  return (
    <>
      <SettingGroup label="장기 기억">
        <SettingRow label="사용" help={usage} control={<Switch label="장기 기억" checked={value.on} onChange={(on) => onChange({ on })} />} />
      </SettingGroup>
      {children}
      <Disclosure label="세부 설정">
        <SettingGroup label="세부 설정">{rows}</SettingGroup>
      </Disclosure>
    </>
  );
}
