import type { GuestTransferStep } from '../../runtime/account/guest-transfer';
import { Brand, Progress, Screen, Text, type ProgressStep } from '../ui';

export type Moved = { title: string; steps: Partial<Record<GuestTransferStep['kind'], GuestTransferStep>> };

// In transferGuest's order: the pictures go up first, then the objects that name them.
const STAGES: { kind: GuestTransferStep['kind']; label: string }[] = [
  { kind: 'pictures', label: '이미지' },
  { kind: 'objects', label: '내용' },
];

export function MovingScreen({ moved }: { moved: Moved }) {
  const steps = STAGES.map(({ kind, label }): ProgressStep => {
    const step = moved.steps[kind];
    return step ? { label, done: step.done, total: step.total } : { label };
  });
  return (
    <Screen top={<Brand />} align="center">
      <Progress hero title={moved.title} steps={steps} />
      <Text variant="note" align="center">
        창을 닫아도 다음에 로그인하면 이어서 올려요.
      </Text>
    </Screen>
  );
}
