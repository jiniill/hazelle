import { useState, type FormEvent } from 'react';
import type { ConnectionType } from '../../connectors/types';
import { providerConnection } from '../../runtime/models/connections';
import { useAttempt } from '../common/useAttempt';
import { MARKS } from '../common/tutorial';
import { useSession } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, GuideMark, Intro, NavBar, Screen } from '../ui';
import { connect } from './connect';
import { KeyField } from './KeyField';

export function ConnectionKeyScreen({ type, back }: { type: ConnectionType; back: Back }) {
  const session = useSession();
  const [key, setKey] = useState('');
  const { busy, failure, run } = useAttempt();
  const secret = key.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret) return;
    await run((signal) => connect(session, providerConnection(type, secret), signal));
  }

  return (
    <Screen
      top={<NavBar title={`${type.label} 연결`} {...backBar(back)} />}
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy} disabled={!secret}>
          모델 선택
        </Button>
      }
    >
      <Intro title={type.label}>{type.description}</Intro>
      <GuideMark name={MARKS.connectKey}>
        <KeyField type={type} value={key} onChange={setKey} />
      </GuideMark>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
