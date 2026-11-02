import { Link, MessageSquarePlus, PackageOpen, Plug, UserRoundPlus } from 'lucide-react';
import { ACTS, importOf, newOf } from '../common/acts';
import { GuestAgreement, GuestLine } from '../common/GuestNotice';
import { MARKS } from '../common/tutorial';
import { TUTORIAL, useTutorials } from '../common/Tutorial';
import { useChats, useConnections } from '../session';
import { navigate } from '../shell/router';
import { ActionCard, Button, Columns, GuideMark, Intro, Row, Screen, Stack } from '../ui';
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
      <Row kind="spread">
        <Intro title={chats.length ? '어디서 이어 갈까요?' : '비어 있어요'} />
        {tutorials.offered.length > 0 && (
          <Button variant="ghost" size="sm" icon={TUTORIAL.icon} onClick={tutorials.open}>
            {TUTORIAL.open}
          </Button>
        )}
      </Row>
      <Stack>
        <Columns min="wide">
          {connections.length > 0 ? (
            <ActionCard tone="accent" icon={MessageSquarePlus} title="새 채팅" description="캐릭터 없이 모델과 바로 대화해요" onClick={() => navigate({ kind: 'new-chat', character: null })} />
          ) : (
            <GuideMark name={MARKS.connectNew}>
              <ActionCard tone="accent" icon={Plug} title={newOf('연결')} description="제공자를 선택하고 API 키를 입력해요" onClick={() => navigate({ kind: 'add-connection' })} />
            </GuideMark>
          )}
          <ActionCard icon={PackageOpen} title="Risu에서 이사" description="캐릭터와 채팅, 프롬프트를 한 번에 옮겨요" onClick={move} />
        </Columns>
        <Columns min={connections.length > 0 ? 'wide' : 'small'}>
          <ActionCard size="sm" icon={ACTS.import.icon} title={importOf('봇')} description="PNG · charx · zip 파일을 끌어다 놓거나 선택해요" onClick={pick} />
          <ActionCard size="sm" icon={Link} title="링크로 가져오기" description="Realm, Proton, 파일 링크를 붙여 넣어요" onClick={pickLink} />
          <ActionCard size="sm" icon={UserRoundPlus} title={newOf('캐릭터')} description="이름과 설명부터 직접 입력해요" onClick={create} />
          {connections.length > 0 && <ActionCard size="sm" icon={Plug} title="연결" description={`연결 ${connections.length}개 · 모델 추가`} onClick={() => navigate({ kind: 'connections' })} />}
        </Columns>
      </Stack>
      <Stack>
        <GuestLine />
        <GuestAgreement />
      </Stack>
    </Stack>
  );
}

export function HomeScreen() {
  return (
    <Screen align="center" width="form">
      <Welcome />
    </Screen>
  );
}
