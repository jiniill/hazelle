import { Lamp, Link, PackageOpen, Plug, UserRoundPlus } from 'lucide-react';
import { isUntouchedStarter } from '../../model/library';
import { ACTS, importOf, newOf } from '../common/acts';
import { withParticle } from '../common/particles';
import { GuestAgreement, GuestLine } from '../common/GuestNotice';
import { MARKS } from '../common/tutorial';
import { TUTORIAL, useTutorials } from '../common/Tutorial';
import { useChats, useConnections, useLibrary } from '../session';
import { navigate } from '../shell/router';
import { ActionCard, Button, Columns, GuideMark, Intro, Row, Screen, Stack } from '../ui';
import { useImport } from '../common/importing';
import { useNewCharacter } from './useCharacterActions';
import { LINK_IMPORT, MOVE_IN } from '../common/words';

export function Welcome() {
  const connections = useConnections();
  const chats = useChats();
  const { pick, pickLink, move } = useImport();
  const create = useNewCharacter();
  // The starter character while nobody has talked to her: where the list is not on screen, this is her door.
  const starter = useLibrary().characters.find(isUntouchedStarter);
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
            <ActionCard tone="accent" icon={ACTS.newChat.icon} title={ACTS.newChat.label} description="캐릭터 없이 모델과 바로 대화해요" onClick={() => navigate({ kind: 'new-chat', character: null })} />
          ) : (
            <GuideMark name={MARKS.connectNew}>
              <ActionCard tone="accent" icon={Plug} title={newOf('연결')} description="제공자를 선택하고 API 키를 입력해요" onClick={() => navigate({ kind: 'add-connection' })} />
            </GuideMark>
          )}
          <ActionCard icon={PackageOpen} title={MOVE_IN} description="캐릭터와 채팅, 프롬프트를 한 번에 옮겨요" onClick={move} />
          {starter && <ActionCard icon={Lamp} title={`${withParticle(starter.character.card.name, '과/와')} 대화`} description="기본 캐릭터에게 말을 걸어 봐요" onClick={() => navigate({ kind: 'new-chat', character: starter.id })} />}
        </Columns>
        <Columns min={connections.length > 0 ? 'wide' : 'small'}>
          <ActionCard size="sm" icon={ACTS.import.icon} title={importOf('봇')} description="PNG · charx · zip 파일을 끌어다 놓거나 선택해요" onClick={pick} />
          <ActionCard size="sm" icon={Link} title={LINK_IMPORT} description="Realm, Proton, 파일 링크를 붙여 넣어요" onClick={() => pickLink('')} />
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
