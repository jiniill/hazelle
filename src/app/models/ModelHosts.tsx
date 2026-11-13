import { costUnit } from '../../connectors/registry';
import { entryKey, type ConnectionType, type Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { setModelHost } from '../../runtime/models/connections';
import { loadHosts, type HostsFailure } from '../../runtime/models/hosts';
import { describeHostsFailure } from '../common/failure';
import { priceLine } from '../common/money';
import { useLoad } from '../common/useLoaded';
import { CHANGE_FAILED, HOST, LOADING } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import { List, ListItem, Section, Text } from '../ui';

type Props = { connection: Stored<'connection'>; model: Starred; type: ConnectionType };

// Who serves the model behind a gateway (ConnectionType hosts), and the one this entry's calls go to.
export function ModelHosts({ connection, model, type }: Props) {
  const { store } = useSession();
  const toast = useToast();
  const hosts = useLoad(
    async (signal) => {
      const loaded = (await loadHosts(connection.value, model.id, signal))!;
      if (loaded.ok) return loaded.hosts;
      throw loaded.failure;
    },
    [connection.id, model.id],
    { describe: (failure) => describeHostsFailure(failure as HostsFailure) },
  );
  const pick = (host: string | null) => toast.settled(setModelHost(store, connection.id, entryKey(model), host), CHANGE_FAILED);
  const gone = model.host !== undefined && hosts.data !== undefined && !hosts.data.some((host) => host.id === model.host);

  return (
    <Section title={HOST} help="선택한 제공자에게만 요청을 보내고, 응답을 받지 못하면 실패해요.">
      {hosts.failure}
      {hosts.loading && <Text variant="note">{LOADING}</Text>}
      {hosts.data && (
        <List label={HOST} box>
          <ListItem title="자동" description={`${connection.value.label}에서 선택해요`} selected={model.host === undefined} onClick={() => pick(null)} />
          {gone && <ListItem title={model.host!} note="목록에 없음" tone="muted" selected />}
          {hosts.data.map((host) => (
            <ListItem
              key={host.id}
              title={host.name}
              code={host.id}
              tags={host.discount ? ['할인 가능'] : []}
              note={priceLine(host.price, costUnit(type))}
              selected={host.id === model.host}
              onClick={() => pick(host.id)}
            />
          ))}
        </List>
      )}
    </Section>
  );
}
