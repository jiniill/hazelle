import { Send } from 'lucide-react';
import { BOARD } from '../common/words';
import { useAccount } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, NavBar, Row, Screen } from '../ui';
import { useOwnNickname } from './nickname';
import { PostList } from './parts';

// What this account or guest wrote, public and operator-only alike. Guests never ask for a nickname.
export function MineScreen({ back }: { back: Back }) {
  const { guest } = useAccount();
  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={BOARD.mine}
          {...backBar(back)}
          actions={
            <Button variant="secondary" icon={Send} onClick={() => navigate({ kind: 'board-write', operator: true })}>
              {BOARD.toOperator}
            </Button>
          }
        />
      }
    >
      {!guest && <MineNickname />}
      <PostList ask={{ sort: 'new', mine: true }} label={BOARD.mine} empty="쓴 글이 없어요." />
    </Screen>
  );
}

function MineNickname() {
  const own = useOwnNickname();
  return (
    <>
      {own.loaded.failure}
      {own.loaded.data && (
        <Row kind="spread">
          {own.line}
          {own.change}
        </Row>
      )}
      {own.dialog}
    </>
  );
}
