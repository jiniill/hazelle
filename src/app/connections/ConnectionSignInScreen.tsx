import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { ConnectionType, SignIn } from '../../connectors/types';
import { providerConnection } from '../../runtime/models/connections';
import { ACTS } from '../common/acts';
import { MARKS } from '../common/tutorial';
import { useSession } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, CodeCard, GuideMark, Intro, NavBar, Screen, Text } from '../ui';
import { connect } from './connect';
import { useDeviceSignIn } from './useDeviceSignIn';

export function ConnectionSignInScreen({ type, signIn, back }: { type: ConnectionType; signIn: SignIn; back: Back }) {
  const session = useSession();
  const [attempt, setAttempt] = useState(0);
  const { stage, openSite } = useDeviceSignIn(signIn, attempt, (secret, name, signal) => connect(session, providerConnection(type, secret, name), signal));

  const top = <NavBar title={`${type.label} 연결`} {...backBar(back)} />;

  if (stage.step === 'failed') {
    return (
      <Screen
        top={top}
        actions={
          <Button icon={ACTS.retry.icon} onClick={() => setAttempt((count) => count + 1)}>
            {ACTS.retry.label}
          </Button>
        }
      >
        <Intro title="연결하지 못했어요" />
        <Callout tone="warn" alert>
          {stage.message}
        </Callout>
      </Screen>
    );
  }

  if (stage.step === 'code') {
    const { code } = stage;
    return (
      <Screen
        top={top}
        actions={
          <>
            <Text variant="note">
              승인 대기 중 · 코드 유효 시간 {Math.round(code.expiresIn / 60)}분
            </Text>
            <GuideMark name={MARKS.connectKey}>
              <Button icon={ExternalLink} onClick={() => openSite(code)}>
                코드 복사하고 {signIn.site} 열기
              </Button>
            </GuideMark>
          </>
        }
      >
        <Intro title={`${signIn.site}에서 이 코드를 입력해 주세요`}>승인하면 자동으로 연결돼요.</Intro>
        <CodeCard label="코드" code={code.userCode} />
      </Screen>
    );
  }

  return (
    <Screen
      top={top}
      actions={
        <Button busy>
          {stage.step === 'starting' ? '코드 받는 중' : '연결하는 중'}
        </Button>
      }
    >
      <Intro title={stage.step === 'starting' ? `${signIn.site} 로그인 준비` : '연결하는 중'} />
    </Screen>
  );
}
