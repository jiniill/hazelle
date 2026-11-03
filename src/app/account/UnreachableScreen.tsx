import { ACTS } from '../common/acts';
import { CONTACT, REPOSITORY } from '../common/legal';
import { Brand, Button, Intro, Link, Screen, Text } from '../ui';

export function UnreachableScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Screen top={<Brand />} actions={<Button onClick={onRetry}>{ACTS.retry.label}</Button>}>
      <Intro title="지금은 열 수 없어요">{message}</Intro>
      {/* Until guests can write on the board, the way out for a failure, a failed 계정 만들기 above all. */}
      <Text variant="note">
        계정 없이 알리려면 <Link href={`${REPOSITORY}/issues/new`}>GitHub 이슈</Link>나 <Link href={`mailto:${CONTACT}`}>메일</Link>로 보내 주세요.
      </Text>
    </Screen>
  );
}
