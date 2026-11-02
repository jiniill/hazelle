import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { ConnectionType, Model } from '../../connectors/types';
import type { Session } from '../../runtime/session';
import { connectTrial, openTrial, pickTrialModel, sayInTrial, startTrialChat, talkableModels } from '../../runtime/trial';
import { describeCatalogFailure, describeFailure, describeKeyFailure, describeTurnFailure } from '../common/failure';
import { href } from '../shell/routes';
import { Button, Callout, List, ListItem, Progress, Said, SendRow, Stack, TextField } from '../ui';

type Phase =
  | { kind: 'connecting' }
  | { kind: 'models'; session: Session; connection: string; models: Model[] }
  | { kind: 'listless'; connection: string; message: string }
  | { kind: 'chat'; session: Session };

const open = (at: string) => location.assign(at);

// Runs the rest of the first visit on this browser's guest, loaded only once a key is entered: the engine is the page's heaviest part.
export function Trial({ type, secret, onStep, onRefused }: { type: ConnectionType; secret: string; onStep: (step: number) => void; onRefused: (message: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting' });
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const leaving = new AbortController();
    let session: Session | null = null;
    void (async () => {
      const opened = await openTrial(leaving.signal);
      if (leaving.signal.aborted) return opened.ok ? opened.data.close() : undefined;
      if (!opened.ok) return onRefused(describeFailure(opened));
      session = opened.data;
      const connected = await connectTrial(session, type, secret, leaving.signal);
      if (leaving.signal.aborted) return;
      if (!connected.ok) return onRefused(describeKeyFailure(connected.failure));
      onStep(1);
      if (connected.catalog.ok) setPhase({ kind: 'models', session, connection: connected.id, models: talkableModels(connected.catalog.models) });
      else setPhase({ kind: 'listless', connection: connected.id, message: describeCatalogFailure(connected.catalog.failure) });
    })();
    return () => {
      leaving.abort();
      session?.close();
    };
  }, [type, secret]);

  if (phase.kind === 'connecting') return <Progress title="모델 불러오는 중" steps={[{ label: `${type.label} 연결` }]} />;
  if (phase.kind === 'listless') {
    return (
      <Stack>
        <Callout tone="warn" alert>{phase.message}</Callout>
        <div><Button onClick={() => open(href({ kind: 'connection', id: phase.connection }))}>앱에서 이어 가기</Button></div>
      </Stack>
    );
  }
  if (phase.kind === 'chat') return <TrialChat session={phase.session} />;
  return (
    <ModelPick
      models={phase.models}
      failure={failure}
      onPick={(model) => {
        void pickTrialModel(phase.session, phase.connection, model).then((added) => {
          if (!added.ok) return setFailure(describeFailure(added));
          onStep(2);
          setPhase({ kind: 'chat', session: phase.session });
        });
      }}
    />
  );
}

function ModelPick({ models, failure, onPick }: { models: Model[]; failure: string | null; onPick: (model: Model) => void }) {
  const [search, setSearch] = useState('');
  const shown = useMemo(() => models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(search.trim().toLowerCase())), [models, search]);
  return (
    <Stack>
      <TextField label="모델 검색" showLabel={false} placeholder={`모델 ${models.length}개 검색`} value={search} onChange={setSearch} />
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
      <List label="모델" box>
        {shown.slice(0, MODELS_SHOWN).map((model) => <ListItem key={model.id} title={model.name} code={model.id} onClick={() => onPick(model)} />)}
      </List>
    </Stack>
  );
}
const MODELS_SHOWN = 8;

function TrialChat({ session }: { session: Session }) {
  const [chat] = useState(() => crypto.randomUUID());
  const [log, setLog] = useState<{ by: 'me' | 'them'; text: string }[]>([]);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const turn = useSyncExternalStore(session.talk.subscribe, () => session.talk.snapshot(chat));
  const live = useRef('');
  if (turn) live.current = turn.text;
  const replied = log.some(({ by }) => by === 'them');

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || turn) return;
    setDraft('');
    setFailure(null);
    setLog((now) => [...now, { by: 'me', text }]);
    live.current = '';
    const failed = await (log.length === 0 ? startTrialChat(session, chat, text) : sayInTrial(session, chat, text));
    if (failed) return setFailure(describeTurnFailure(failed));
    setLog((now) => [...now, { by: 'them', text: live.current }]);
  }

  return (
    <form onSubmit={(event) => void send(event)}>
      <Stack>
        {log.map(({ by, text }, index) => <Said key={index} by={by}>{text}</Said>)}
        {turn && <Said by="them">{turn.text || '…'}</Said>}
        {failure && <Callout tone="warn" alert>{failure}</Callout>}
        <SendRow>
          <TextField label="보낼 말" showLabel={false} placeholder="안녕! 짧게 자기소개해 줘" value={draft} onChange={setDraft} />
          <Button type="submit" disabled={!draft.trim() || turn !== null}>보내기</Button>
        </SendRow>
        {replied && <div><Button onClick={() => open(href({ kind: 'chat', id: chat }))}>앱에서 대화 이어 가기</Button></div>}
      </Stack>
    </form>
  );
}
