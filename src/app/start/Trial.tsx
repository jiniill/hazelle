import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { isFree } from '../../connectors/pricing';
import type { ConnectionType, LeftMeter, Model } from '../../connectors/types';
import { countFirstPage } from '../../runtime/service/first-page';
import type { Session } from '../../runtime/session';
import { connectTrial, freeAllowance, openTrial, pickTrialModel, sayInTrial, startTrialChat, talkableModels } from '../../runtime/account/trial';
import { ARIN } from '../common/arin';
import { describeCatalogFailure, describeFailure, describeKeyFailure, describeTurnFailure } from '../common/failure';
import { href } from '../shell/routes';
import { meterLabel, meterLeft } from '../common/meters';
import { Connecting, ModelPick } from '../common/ModelPick';
import { Button, Callout, Said, SendRow, Stack, TalkBox, Text, TextField } from '../ui';

type Phase =
  | { kind: 'connecting' }
  | { kind: 'models'; session: Session; connection: string; models: Model[] }
  | { kind: 'listless'; connection: string; message: string }
  | { kind: 'chat'; session: Session; connection: string; free: boolean };

const open = (at: string) => {
  countFirstPage('entered');
  location.assign(at);
};

// Runs the rest of the visit, loaded only once a key is entered: the engine is the page's heaviest part.
// kept: on this browser's guest, so the app opens on it; otherwise on a throwaway session, with no way into the app.
export function Trial({ type, secret, kept, onStep, onReplied, onRefused }: { type: ConnectionType; secret: string; kept: boolean; onStep: (step: number) => void; onReplied: () => void; onRefused: (message: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting' });
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const leaving = new AbortController();
    let session: Session | null = null;
    void (async () => {
      const opened = await openTrial(leaving.signal, kept, ARIN);
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

  if (phase.kind === 'connecting') return <Connecting type={type} />;
  if (phase.kind === 'listless') {
    return (
      <Stack>
        <Callout tone="warn" alert>{phase.message}</Callout>
        {kept && <div><Button onClick={() => open(href({ kind: 'connection', id: phase.connection }))}>앱에서 이어 가기</Button></div>}
      </Stack>
    );
  }
  if (phase.kind === 'chat') return <TrialChat session={phase.session} connection={phase.connection} free={phase.free} kept={kept} onReplied={onReplied} />;
  return (
    <ModelPick
      models={phase.models}
      failure={failure}
      onPick={(model) => {
        void pickTrialModel(phase.session, phase.connection, model).then((added) => {
          if (!added.ok) return setFailure(describeFailure(added));
          onStep(2);
          setPhase({ kind: 'chat', session: phase.session, connection: phase.connection, free: isFree(model) });
        });
      }}
    />
  );
}

function allowanceLine(meter: LeftMeter) {
  const { amount, of } = meterLeft(meter);
  return `${meterLabel(meter)} · ${amount} ${of}`;
}

function TrialChat({ session, connection, free, kept, onReplied }: { session: Session; connection: string; free: boolean; kept: boolean; onReplied: () => void }) {
  const [chat] = useState(() => crypto.randomUUID());
  const [log, setLog] = useState<{ by: 'me' | 'them'; text: string }[]>([]);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const turn = useSyncExternalStore(session.talk.subscribe, () => session.talk.snapshot(chat));
  const live = useRef('');
  if (turn) live.current = turn.text;
  const replied = log.some(({ by }) => by === 'them');
  const [turns, setTurns] = useState(0);
  const [allowance, setAllowance] = useState<LeftMeter | null>(null);
  useEffect(() => {
    if (!free) return;
    let current = true;
    void freeAllowance(session, connection, turns > 0).then((left) => current && setAllowance(left));
    return () => {
      current = false;
    };
  }, [turns]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || turn) return;
    setDraft('');
    setFailure(null);
    setLog((now) => [...now, { by: 'me', text }]);
    live.current = '';
    const failed = await (log.length === 0 ? startTrialChat(session, chat, text, ARIN) : sayInTrial(session, chat, text));
    setTurns((held) => held + 1);
    if (failed) return setFailure(describeTurnFailure(failed));
    setLog((now) => [...now, { by: 'them', text: live.current }]);
    onReplied();
  }

  return (
    <TalkBox
      onSubmit={(event) => void send(event)}
      foot={
        <>
          <SendRow>
            <TextField label="보낼 말" showLabel={false} placeholder="길을 잃은 것 같아요" value={draft} onChange={setDraft} />
            <Button type="submit" disabled={!draft.trim() || turn !== null}>보내기</Button>
          </SendRow>
          {allowance && <Text variant="note">{allowanceLine(allowance)}</Text>}
          {kept && replied && <div><Button onClick={() => open(href({ kind: 'chat', id: chat }))}>앱에서 대화 이어 가기</Button></div>}
        </>
      }
    >
      <Said by="them" name={ARIN.name}>{ARIN.greeting}</Said>
      {log.map(({ by, text }, index) => <Said key={index} by={by} name={by === 'them' ? ARIN.name : undefined}>{text}</Said>)}
      {turn && <Said by="them" name={ARIN.name} typing>{turn.text}</Said>}
      {failure && <Callout tone="warn" alert>{failure}</Callout>}
    </TalkBox>
  );
}
