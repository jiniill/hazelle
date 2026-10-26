import { useEffect, useState } from 'react';
import { GENERIC, resolveConnection, searchTypes } from '../../connectors/registry';
import type { Connection, ConnectionType } from '../../connectors/types';
import { newAccount, providerConnection } from '../../runtime/connections';
import { count as counted } from '../common/typedNumber';
import { newOf } from '../common/acts';
import { noResults } from '../common/search';
import { DIRECT_CONNECTION, NEEDS_ACCOUNT } from '../common/words';
import { useAttempt } from '../common/useAttempt';
import { MARKS } from '../common/tutorial';
import { useAccount, useConnections, useSession } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, Empty, GuideMark, List, ListItem, NavBar, Screen, SearchField, Section, Stack, Text } from '../ui';
import { connect } from './connect';

const GROUPS: Record<ConnectionType['group'], string> = {
  gateway: '여러 회사 모델을 한 키로',
  maker: '제작사 API로',
  subscription: '구독 계정으로',
};

// Ollama, LM Studio and koboldcpp at the ports launch.ts and docker-compose.yml list; another listed one goes by its address.
const LOCAL_NAMES: Partial<Record<string, string>> = { '11434': 'Ollama', '1234': 'LM Studio', '5001': 'koboldcpp' };

const localConnection = (address: string): Connection => ({
  type: GENERIC,
  label: LOCAL_NAMES[address.split(':').at(-1)!] ?? address,
  baseUrl: `http://${address}/v1`,
  protocol: 'chat-completions',
  accounts: [newAccount('')],
  turns: null,
  starred: [],
});

// The model servers a self-host lists (HAZELLE_LOCAL_PROVIDERS) that answer with a model list now; hazelle.app lists none.
function useLocalServers(addresses: readonly string[]) {
  const session = useSession();
  const [found, setFound] = useState<{ address: string; connection: Connection; models: number }[]>([]);
  useEffect(() => {
    let open = true;
    void Promise.all(
      addresses.map(async (address) => {
        const connection = localConnection(address);
        const catalog = await session.catalogs.load(connection);
        return catalog.ok ? [{ address, connection, models: catalog.models.length }] : [];
      }),
    ).then((lists) => open && setFound(lists.flat()));
    return () => {
      open = false;
    };
  }, [session, addresses]);
  return found;
}

export function ConnectionAddScreen({ back }: { back: Back }) {
  const session = useSession();
  const { guest, localProviders } = useAccount();
  const local = useLocalServers(localProviders);
  const connections = useConnections();
  const route = useRoute();
  const [query, setQuery] = useState('');
  const { busy, failure, run } = useAttempt();

  const search = searchTypes(query);
  const shown = search.kind === 'types' ? search.types : search.kind === 'key' ? [search.type] : [];
  const connected = (type: ConnectionType) => connections.filter((entry) => resolveConnection(entry.value)?.type === type).length;
  const connectKey = (type: ConnectionType, secret: string) => run((signal) => connect(session, providerConnection(type, secret), signal));
  // A major type stays in its group too, so it is found in either place. A narrowed list has no 주요.
  const sections: [string, readonly ConnectionType[]][] = [
    ['주요', query.trim() ? [] : shown.filter((type) => type.major)],
    ...(Object.keys(GROUPS) as ConnectionType['group'][]).map((group): [string, readonly ConnectionType[]] => [GROUPS[group], shown.filter((type) => type.group === group)]),
  ];
  const firstShown = sections.find(([, types]) => types.length)?.[0];

  return (
    <Screen top={<NavBar title={newOf('연결')} {...backBar(back)} />}>
      <SearchField label="이름 검색, 또는 키·주소 붙여 넣기" value={query} onChange={setQuery} />
      {search.kind === 'key' && (
        <Stack gap="related">
          <Callout tone="success">{search.type.label} 키예요.</Callout>
          <Button busy={busy} onClick={() => void connectKey(search.type, search.secret)}>
            이 키로 연결하고 모델 선택
          </Button>
        </Stack>
      )}
      {search.kind === 'address' && <Text variant="note">목록에 없는 주소는 아래의 {DIRECT_CONNECTION}로 추가해요.</Text>}
      {search.kind === 'none' && <Empty>{noResults(query.trim())}</Empty>}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
      {!query.trim() && local.length > 0 && (
        <Section title="이 컴퓨터의 모델 서버">
          <List label="이 컴퓨터의 모델 서버" places>
            {local.map(({ address, connection, models }) => {
              const count = connections.filter((entry) => entry.value.baseUrl === connection.baseUrl).length;
              return (
                <ListItem
                  key={address}
                  title={connection.label}
                  description={connection.label === address ? `모델 ${counted(models)}개` : `${address} · 모델 ${counted(models)}개`}
                  tags={count ? [`연결 ${count}개`] : []}
                  onClick={() => void run((signal) => connect(session, connection, signal))}
                />
              );
            })}
          </List>
        </Section>
      )}
      {sections.map(([title, types]) =>
        types.length ? (
          <GuideMark key={title} name={title === firstShown ? MARKS.connectType : null}>
            <Section title={title}>
              <List label={title} places>
                {types.map((type) => {
                  const count = connected(type);
                  return (
                    <ListItem
                      key={type.id}
                      title={type.label}
                      description={type.description}
                      tags={[type.signIn ? `${type.signIn.site} 로그인` : (type.keyForm?.label ?? 'API 키'), ...(count ? [`연결 ${count}개`] : []), ...(guest && !type.browser ? [NEEDS_ACCOUNT] : [])]}
                      current={route.kind === 'connect' && route.type === type}
                      onClick={() => navigate({ kind: 'connect', type })}
                    />
                  );
                })}
              </List>
            </Section>
          </GuideMark>
        ) : null,
      )}
      <Section title="목록에 없는 제공자">
        <List label={DIRECT_CONNECTION} places>
          <ListItem
            title={DIRECT_CONNECTION}
            description="OpenAI 호환, OpenAI Responses, Anthropic 호환 주소와 키로 연결해요."
            current={route.kind === 'connect-direct'}
            onClick={() => navigate({ kind: 'connect-direct', address: search.kind === 'address' ? search.baseUrl : '' })}
          />
        </List>
      </Section>
    </Screen>
  );
}
