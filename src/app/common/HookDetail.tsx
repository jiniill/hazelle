import type { HookLog } from '../../engine/lua/run';
import { Callout, CodeBlock, Facts, Stack, Text } from '../ui';

export const shownValue = (value: string, truncated: boolean) => (value === '' ? '(빈 값)' : truncated ? `${value}…` : value);

export function HookDetail({ entry }: { entry: HookLog }) {
  return (
    <Stack gap="related">
      {entry.errors.map((error, index) => (
        <Callout key={index} tone="warn">{'message' in error ? error.message : `${error.script} 실패`}</Callout>
      ))}
      {entry.logs.length > 0 && <CodeBlock>{entry.logs.join('\n')}</CodeBlock>}
      {entry.writes.length > 0 && <Facts items={entry.writes.map(([name, value]) => ({ label: name, value: shownValue(value, false) }))} />}
      {entry.missing.length > 0 && <Text variant="note">{`지원하지 않는 기능: ${entry.missing.join(', ')}`}</Text>}
      {entry.truncated && <Text variant="note">내용이 길어서 일부만 남겼어요.</Text>}
    </Stack>
  );
}
