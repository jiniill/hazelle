import { RETRY_MOST } from '../../contracts/streams';
import { NumberInput, SettingRow } from '../ui';
import { useTypedNumber } from './typed';
import { readOptional, reader } from './typedNumber';
import { RETRY_COUNT, RETRY_HELP } from './words';

// undefined: left empty. null: not a count the field takes.
const readRetries = reader((text) => {
  const count = readOptional(text, true);
  return count === undefined || (count !== null && count >= 0 && count <= RETRY_MOST) ? count : null;
}, `0부터 ${RETRY_MOST} 사이의 정수를 입력해 주세요.`);

// A count over the one above it (a connection's over the shared one, a 설정 묶음's over its connection's). Left empty, it
// follows that one, which the placeholder names.
export function RetriesRow({ value, follows, onChange }: { value: number | undefined; follows: string; onChange: (retries: number | undefined) => void }) {
  const field = useTypedNumber(readRetries, value, { onChange });
  return (
    <SettingRow
      label={RETRY_COUNT}
      help={RETRY_HELP}
      changed={value !== undefined}
      error={field.error}
      control={<NumberInput label={RETRY_COUNT} value={field.text} placeholder={follows} invalid={field.error !== undefined} onChange={field.change} />}
    />
  );
}
