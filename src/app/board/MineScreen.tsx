import { Send } from 'lucide-react';
import { useState } from 'react';
import { readNickname } from '../../runtime/board';
import { AuthorLine } from '../common/postRow';
import { useLoaded } from '../common/useLoaded';
import { BOARD } from '../common/words';
import { useAccount } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, NavBar, Row, Screen } from '../ui';
import { NicknameDialog } from './nickname';
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
  const { admin } = useAccount();
  const nickname = useLoaded(readNickname);
  const [changing, setChanging] = useState(false);
  const name = nickname.data?.name;
  return (
    <>
      {nickname.failure}
      {nickname.data && (
        <Row kind="spread">
          <AuthorLine author={{ name: name ?? null, operator: admin, mine: true, left: false }} note={admin ? undefined : BOARD.nickname} size="md" />
          {/* The operator writes as 운영자, which no one picks or changes. */}
          {!admin && (
            <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
              {name ? '바꾸기' : '설정'}
            </Button>
          )}
        </Row>
      )}
      {changing && (
        <NicknameDialog
          current={name ?? null}
          onSet={() => {
            setChanging(false);
            nickname.reload();
          }}
          onClose={() => setChanging(false)}
        />
      )}
    </>
  );
}
