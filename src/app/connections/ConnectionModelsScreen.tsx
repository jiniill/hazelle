import { KeyRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { bareModel } from '../../connectors/chat-completions';
import { modelSettings, resolveConnection, RETRIES } from '../../connectors/registry';
import { refOf } from '../../connectors/assignment';
import { entriesOf, entryKey, entryName, entryTerms, type Model, type Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { catalogKey, type CatalogResult } from '../../runtime/catalog';
import { addCopy, addModel, putModelBack, refreshStarred, removeConnection, removeModel, renameConnection, restoreConnection, setRetries } from '../../runtime/connections';
import { modelProfile } from '../../runtime/profiles';
import { ACTS, addOf } from '../common/acts';
import { describeCatalogFailure } from '../common/failure';
import { DetailFold } from '../common/DetailFold';
import { NameDialog } from '../common/NameDialog';
import { useSearch } from '../common/useSearch';
import { RetriesRow } from '../common/RetriesRow';
import { followsRetries, profileLine } from '../common/settingWords';
import { useAutosave } from '../common/useAutosave';
import { MODEL_SETTINGS } from '../common/words';
import { MARKS } from '../common/tutorial';
import { useSession, useSettings } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Columns, Empty, GuideMark, IconButton, ItemSection, List, ListItem, MenuItem, NavBar, Panel, Row, Screen, Stack, Text, usePane } from '../ui';
import { ConnectionAccounts } from './ConnectionAccounts';
import { ConnectionKeyDialog } from './ConnectionKeyDialog';
import { ConnectionMeters } from './ConnectionMeters';
import { ConnectionSent } from './ConnectionSent';

const BY_ID = '모델 ID로 추가';

type Filter = 'all' | 'reasoning' | 'vision' | 'tools';

const FILTERS: Record<Exclude<Filter, 'all'>, { label: string; test: (model: Model) => boolean }> = {
  reasoning: { label: '추론', test: (model) => model.reasoning === true },
  vision: { label: '비전', test: (model) => model.input?.includes('image') === true },
  tools: { label: '도구', test: (model) => model.tools === true },
};
const FILTER_CHOICES = [{ value: 'all' as const, label: '전체' }, ...(Object.entries(FILTERS) as [Filter, { label: string }][]).map(([value, { label }]) => ({ value, label }))];

// Only what the catalog says a model can do. An unknown capability gets no tag.
function tags(model: Model): string[] {
  return Object.values(FILTERS)
    .filter((filter) => filter.test(model))
    .map((filter) => filter.label);
}

export function ConnectionModelsScreen({ stored, back }: { stored: Stored<'connection'>; back: Back }) {
  const { store, catalogs } = useSession();
  const { retries: shared, profile: defaultProfile } = useSettings();
  const toast = useToast();
  const { id, value: connection } = stored;
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState<Model | null>(null);
  const [keying, setKeying] = useState(false);
  // Under API 연결's cards the connection is a part of that page, not a page of its own.
  const stacked = usePane() === 'stack';
  const naming = useAutosave<{ label: string }>(`connection:${id}`, ({ label }) => renameConnection(store, id, label!.trim()));
  const label = naming.unsaved.label ?? connection.label;
  const rename = { label: '연결 이름', placeholder: label, onChange: (next: string) => naming.change({ label: next }) };

  const key = catalogKey(connection);
  useEffect(() => {
    let current = true;
    setCatalog(null);
    void catalogs.load(connection, { fresh: attempt > 0 }).then((result) => {
      if (result.ok) void refreshStarred(store, id, result.models);
      if (current) setCatalog(result);
    });
    return () => {
      current = false;
    };
    // The stored object is replaced on every sync; only a change to its endpoint or key means a new list.
  }, [key, attempt]);

  const entries = connection.starred;
  const listedIds = useMemo(() => (catalog?.ok ? new Set(catalog.models.map((model) => model.id)) : null), [catalog]);
  const rows = useMemo(() => [...entries.map((model) => ({ model, added: true })), ...(catalog?.ok ? catalog.models.map((model: Starred) => ({ model, added: false })) : [])], [catalog, entries]);

  const known = rows.some(({ model }) => tags(model).length > 0);
  const search = useSearch(rows, '모델 검색', ({ model }) => entryTerms(model));
  // With no tags known the filter is hidden, so one picked before cannot keep hiding models.
  const shown = search.found.filter(({ model }) => filter === 'all' || !known || FILTERS[filter].test(model));
  const entriesShown = shown.flatMap(({ model, added }) => (added ? [model] : []));
  const modelsShown = shown.flatMap(({ model, added }) => (added ? [] : [model]));

  // The first add stays on the list; a model already added asks the new entry's name.
  function add(model: Model) {
    if (entriesOf(connection, model.id).length > 0) setCopying(model);
    else void addModel(store, id, model).then((result) => result.ok || toast.failed(result));
  }

  // Saving the name opens the copy's page, since what comes next is changing what differs.
  function copy(model: Model, label: string) {
    setCopying(null);
    void addCopy(store, id, model, label).then((result) => {
      if (result.ok) navigate({ kind: 'model', connection: id, model: result.data });
      else toast.failed(result);
    });
  }

  // Unknown ids add unknown capabilities; listed ids use catalog data.
  // Copies of delisted models retain the existing entry's known values.
  function addById(modelId: string) {
    setAdding(false);
    add((catalog?.ok ? catalog.models.find((model) => model.id === modelId) : undefined) ?? entries.find((entry) => entry.id === modelId) ?? bareModel(modelId));
  }

  function removeEntry(entry: Starred) {
    void removeModel(store, id, entryKey(entry)).then((result) => {
      if (!result.ok) return toast.failed(result);
      toast.undoable(`'${entryName(entry)}' 모델을 뺐어요.`, () => putModelBack(store, id, result.data));
    });
  }

  function entryRow(entry: Starred) {
    const name = entryName(entry);
    const listed = !listedIds || listedIds.has(entry.id);
    const choice = modelSettings(connection, entry) ? modelProfile(store, entry) : null;
    return (
      <ListItem
        key={entryKey(entry)}
        title={name}
        code={entry.id}
        description={choice ? profileLine(choice, defaultProfile) : undefined}
        tags={!listed ? ['목록에 없음'] : entry.protocol === 'unsupported' ? ['지원 안 됨', ...tags(entry)] : tags(entry)}
        trailing={
          <Row kind="actions">
            {choice && (
              <Button variant="ghost" size="sm" label={`${MODEL_SETTINGS} · ${name}`} onClick={() => navigate({ kind: 'model', ...refOf(id, entry) })}>
                {MODEL_SETTINGS}
              </Button>
            )}
            <IconButton icon={X} label={`${name} 빼기`} onClick={() => removeEntry(entry)} />
          </Row>
        }
      />
    );
  }

  function modelRow(model: Model, first: boolean) {
    const count = entriesOf(connection, model.id).length;
    const status = count === 0 ? [] : [count > 1 ? `추가됨 ${count}` : '추가됨'];
    return (
      <ListItem
        key={model.id}
        title={model.name}
        code={model.id}
        tags={[...status, ...(model.protocol === 'unsupported' ? ['지원 안 됨'] : []), ...tags(model)]}
        trailing={
          <GuideMark name={first ? MARKS.modelAdd : null}>
            <IconButton icon={ACTS.create.icon} label={addOf(model.name)} onClick={() => add(model)} />
          </GuideMark>
        }
      />
    );
  }

  async function remove() {
    const removed = await naming.remove(() => removeConnection(store, id));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    navigate({ kind: 'connections' });
    toast.undoable(`'${removed.data.value.label}' 연결을 삭제했어요.`, () => restoreConnection(store, removed.data));
  }

  const resolved = resolveConnection(connection);
  const signIn = resolved?.type?.signIn;
  // Accounts join a pool by signing in, so a pool type always has a sign-in.
  const pool = connection.turns && signIn ? { connection: { ...connection, turns: connection.turns }, signIn } : null;

  const who = connection.turns ? `계정 ${connection.accounts.length}개` : connection.accounts[0]!.name;
  const listed = !catalog ? '모델 목록을 불러오는 중…' : catalog.ok ? `모델 ${catalog.models.length}개` : '모델 목록을 불러오지 못했어요';
  const menu = {
    of: '연결',
    items: (
      <>
        {!connection.turns && resolved && <MenuItem icon={KeyRound} label="키 바꾸기" onClick={() => setKeying(true)} />}
        <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void remove()} />
      </>
    ),
  };
  const level = stacked ? 3 : 2;
  const dialog = (
    <>
      {keying && resolved && <ConnectionKeyDialog id={id} type={resolved.type} onClose={() => setKeying(false)} />}
      {copying && <NameDialog title={addOf(copying.name)} value={`${copying.name} ${entriesOf(connection, copying.id).length + 1}`} hint="이미 추가한 모델이에요. 이름과 모델 설정을 따로 두고 하나 더 추가해요." onSave={(label) => copy(copying, label)} onClose={() => setCopying(null)} />}
      {adding && <NameDialog title={BY_ID} field="모델 ID" value="" hint="목록에 없는 새 모델도 제공자가 쓰는 ID로 추가할 수 있어요." onSave={addById} onClose={() => setAdding(false)} />}
    </>
  );

  const body = (
    <>
      <Columns min="panel">
        <Stack gap="section">
          {pool ? <ConnectionAccounts id={id} connection={pool.connection} signIn={pool.signIn} level={level} /> : <ConnectionMeters connection={connection} level={level} />}
          <ConnectionSent connection={id} level={level} />
        </Stack>
        <Panel
          title="모델"
          level={level}
          action={
            resolved?.codec && (
              <Button variant="secondary" icon={ACTS.create.icon} onClick={() => setAdding(true)}>
                {BY_ID}
              </Button>
            )
          }
        >
          <Text variant="note">{[listed, entries.length ? `추가한 모델 ${entries.length}개` : ''].filter(Boolean).join(' · ')}</Text>
          <Row kind="toolbar">
            {search.field}
            {known && <ChoiceGroup label="모델 필터" options={FILTER_CHOICES} value={filter} onChange={setFilter} />}
          </Row>
          {catalog && !catalog.ok && (
            <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => setAttempt((count) => count + 1) }}>
              {describeCatalogFailure(catalog.failure)}
            </Callout>
          )}
          {shown.length > 0 ? (
            <Stack gap="group">
              {entriesShown.length > 0 && (
                <GuideMark name={MARKS.modelAdded}>
                  <List label="추가한 모델" keys={entriesShown.map(entryKey)} box>{(index) => entryRow(entriesShown[index]!)}</List>
                </GuideMark>
              )}
              {modelsShown.length > 0 && <List label="모델" keys={modelsShown.map((model) => model.id)} box>{(index) => modelRow(modelsShown[index]!, index === 0)}</List>}
            </Stack>
          ) : (
            catalog?.ok && <Empty variant="section">{search.none ?? (filter !== 'all' ? '조건에 맞는 모델이 없어요.' : '모델이 없어요.')}</Empty>
          )}
        </Panel>
      </Columns>
      <DetailFold set={connection.retries === undefined ? 0 : 1}>
        <RetriesRow
          value={connection.retries}
          follows={followsRetries('shared', shared ?? RETRIES)}
          onChange={(retries) => void setRetries(store, id, retries).then((result) => result.ok || toast.failed(result))}
        />
      </DetailFold>
    </>
  );

  return stacked ? (
    <Screen width="page">
      <ItemSection title={label} rename={rename} note={who} menu={menu}>
        {body}
      </ItemSection>
      {dialog}
    </Screen>
  ) : (
    <Screen width="page" top={<NavBar title={label} rename={rename} subtitle={who} status={naming.words} {...backBar(back)} menu={menu} />}>
      {body}
      {dialog}
    </Screen>
  );
}
