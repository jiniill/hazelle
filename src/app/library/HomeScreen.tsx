import { Link, MessageSquarePlus, PackageOpen, Plug, UserRoundPlus } from 'lucide-react';
import { ACTS, importOf, newOf } from '../common/acts';
import { GuestLine, GuestNotice } from '../common/GuestNotice';
import { MARKS } from '../common/tutorial';
import { TUTORIAL, useTutorials } from '../common/Tutorial';
import { usePersisted } from '../common/usePersisted';
import { useAccount, useChats, useConnections } from '../session';
import { navigate } from '../shell/router';
import { ActionCard, GuideMark, Intro, Screen, Stack } from '../ui';
import { useImport } from '../common/importing';
import { useNewCharacter } from './useCharacterActions';

export function Welcome() {
  const connections = useConnections();
  const chats = useChats();
  const { pick, pickLink, move } = useImport();
  const create = useNewCharacter();
  const tutorials = useTutorials();
  return (
    <Stack gap="section">
      <GuestCard />
      <Intro title={chats.length ? '어디서 이어 갈까요?' : '비어 있어요'} />
      <Stack>
        {tutorials.offered.length > 0 && <ActionCard icon={TUTORIAL.icon} title={TUTORIAL.open} description={tutorials.listed} onClick={tutorials.open} />}
        {connections.length > 0 && (
          <ActionCard tone="accent" icon={MessageSquarePlus} title="새 채팅" description="캐릭터 없이 모델과 바로 대화해요" onClick={() => navigate({ kind: 'new-chat', character: null })} />
        )}
        <ActionCard tone={connections.length ? 'plain' : 'accent'} icon={PackageOpen} title="Risu에서 이사" description="캐릭터와 채팅, 프롬프트를 한 번에 옮겨요" onClick={move} />
        <ActionCard icon={ACTS.import.icon} title={importOf('봇')} description="PNG · charx · zip 파일을 끌어다 놓거나 선택해요" onClick={pick} />
        <ActionCard icon={Link} title="링크로 가져오기" description="Realm, Proton, 파일 링크를 붙여 넣어요" onClick={pickLink} />
        <ActionCard icon={UserRoundPlus} title={newOf('캐릭터')} description="이름과 설명부터 직접 입력해요" onClick={create} />
        {connections.length === 0 ? (
          <GuideMark name={MARKS.connectNew}>
            <ActionCard icon={Plug} title={newOf('연결')} description="제공자를 선택하고 API 키를 입력해요" onClick={() => navigate({ kind: 'add-connection' })} />
          </GuideMark>
        ) : (
          <ActionCard icon={Plug} title="연결" description={`연결 ${connections.length}개 · 모델 추가`} onClick={() => navigate({ kind: 'connections' })} />
        )}
      </Stack>
    </Stack>
  );
}

// A guest's limits stand on the empty home, phone list included, until closed on this device, then as GuestLine;
// 설정 › 계정 keeps the card for good.
function GuestCard() {
  const { guest } = useAccount();
  const [closed, setClosed] = usePersisted('risu-alpha:guest-card-closed', (stored) => stored === '1', false, (value) => (value ? '1' : ''));
  if (!guest) return null;
  return closed ? <GuestLine /> : <GuestNotice guest={guest} onClose={() => setClosed(true)} />;
}

export function HomeScreen() {
  return (
    <Screen align="center">
      <Welcome />
    </Screen>
  );
}
