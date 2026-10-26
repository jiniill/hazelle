import { useState, type FormEvent } from 'react';
import { addressProblem, detect, GENERIC } from '../../connectors/registry';
import type { Connection, Protocol } from '../../connectors/types';
import { newAccount, providerConnection } from '../../runtime/connections';
import { HTTPS_ONLY } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { MARKS } from '../common/tutorial';
import { DIRECT_CONNECTION } from '../common/words';
import { useAccount, useSession } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, ChoiceGroup, GuideMark, Intro, NavBar, Screen, Stack, Text, TextField } from '../ui';
import { connect } from './connect';

const PROTOCOLS: { value: Protocol; label: string }[] = [
  { value: 'chat-completions', label: 'OpenAI 호환' },
  { value: 'anthropic-messages', label: 'Anthropic 호환' },
  { value: 'responses', label: 'OpenAI Responses' },
];

const PROBLEMS = {
  'not-https': HTTPS_ONLY,
  local: '내 컴퓨터나 내부 네트워크 주소로는 연결할 수 없어요.',
};

// An address the list does know becomes that provider, so it gets the provider's balance and costs however it was
// entered. address is only where the field starts.
export function ConnectionDirectScreen({ address: pasted, back }: { address: string; back: Back }) {
  const session = useSession();
  const { localProviders } = useAccount();
  const [address, setAddress] = useState(pasted);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [key, setKey] = useState('');
  const { busy, failure, run } = useAttempt();

  const place = detect(address);
  const problem = place?.kind === 'generic-url' ? addressProblem(place.baseUrl, localProviders) : null;
  const secret = key.trim();
  let draft: Connection | null = null;
  if (place?.kind === 'url' && secret) {
    draft = providerConnection(place.type, secret);
  } else if (place?.kind === 'generic-url' && !problem && protocol) {
    draft = { type: GENERIC, label: new URL(place.baseUrl).host, baseUrl: place.baseUrl, protocol, accounts: [newAccount(secret)], turns: null, starred: [] };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    await run((signal) => connect(session, draft, signal));
  }

  return (
    <Screen
      top={<NavBar title={DIRECT_CONNECTION} {...backBar(back)} />}
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy} disabled={!draft}>
          모델 선택
        </Button>
      }
    >
      <Intro title="목록에 없는 제공자 연결">OpenAI 호환, OpenAI Responses, Anthropic 호환 API에 연결할 수 있어요.</Intro>
      <GuideMark name={MARKS.connectKey}>
        <Stack>
          <TextField label="주소" kind="key" value={address} onChange={setAddress} placeholder="https://…/v1" />
          {place?.kind === 'url' && <Callout tone="success">{place.type.label} 주소라서 {place.type.label} 연결로 추가해요.</Callout>}
          {problem && <Callout tone="warn">{PROBLEMS[problem]}</Callout>}
          {place?.kind === 'generic-url' && !problem && (
            <ChoiceGroup label="연결 방식" layout="buttons" options={PROTOCOLS} value={protocol} onChange={setProtocol} />
          )}
          {address.trim() && place?.kind !== 'url' && place?.kind !== 'generic-url' && (
            <Text variant="note">https://로 시작하는 주소를 입력해 주세요.</Text>
          )}
          {(place?.kind === 'url' || (place?.kind === 'generic-url' && !problem)) && (
            <TextField
              label="API 키"
              kind="key"
              value={key}
              onChange={setKey}
              hint={place.kind === 'generic-url' ? '키가 필요 없으면 비워 둬도 돼요.' : undefined}
            />
          )}
        </Stack>
      </GuideMark>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
