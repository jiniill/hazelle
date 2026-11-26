import { useState } from 'react';
import type { ConnectionType, Model } from '../../connectors/types';
import { connectTrial, pickTrialModel, talkableModels } from '../../runtime/account/trial';
import { describeCatalogFailure, describeFailure, describeKeyFailure } from '../common/failure';
import { KeyForm, NO_KEY } from '../common/KeyForm';
import { Connecting, ModelPick } from '../common/ModelPick';
import { useAttempt } from '../common/useAttempt';
import { KEY_KEPT } from '../common/words';
import { useSession } from '../session';
import { navigate } from '../shell/router';
import { Button, Callout, Dialog, Stack } from '../ui';

export const FIRST_KEY = '모델 연결';
export const UNCONNECTED = '아직 연결한 모델이 없어요.';

type Phase =
  | { kind: 'key' }
  | { kind: 'models'; connection: string; models: Model[] }
  | { kind: 'listless'; connection: string; message: string };

// A chat with nothing connected takes its first key and model where it stands, as the first page does
// (start/Trial), so the person never leaves the chat to make a connection.
export function ChatFirstKey({ onClose }: { onClose: () => void }) {
  const session = useSession();
  const [typed, setTyped] = useState(NO_KEY);
  const [phase, setPhase] = useState<Phase>({ kind: 'key' });
  const [trying, setTrying] = useState<ConnectionType | null>(null);
  const { busy, failure, run } = useAttempt();

  function enter(type: ConnectionType, secret: string) {
    setTrying(type);
    void run(async (signal) => {
      const connected = await connectTrial(session, type, secret, signal);
      if (!connected.ok) return describeKeyFailure(connected.failure);
      if (signal.aborted) return null;
      if (connected.catalog.ok) setPhase({ kind: 'models', connection: connected.id, models: talkableModels(connected.catalog.models) });
      else setPhase({ kind: 'listless', connection: connected.id, message: describeCatalogFailure(connected.catalog.failure) });
      return null;
    });
  }

  const pick = (connection: string, model: Model) =>
    void run(async () => {
      const added = await pickTrialModel(session, connection, model);
      if (!added.ok) return describeFailure(added);
      onClose();
      return null;
    });

  return (
    <Dialog title={FIRST_KEY} onClose={onClose}>
      {phase.kind === 'key' && (busy && trying ? <Connecting type={trying} /> : <KeyForm typed={typed} onType={setTyped} refused={failure} privacy={KEY_KEPT} grant onEnter={enter} />)}
      {phase.kind === 'models' && <ModelPick models={phase.models} failure={failure} onPick={(model) => pick(phase.connection, model)} />}
      {phase.kind === 'listless' && (
        <Stack>
          <Callout tone="warn" alert>{phase.message}</Callout>
          <div><Button onClick={() => navigate({ kind: 'connection', id: phase.connection })}>연결 설정 이어 가기</Button></div>
        </Stack>
      )}
    </Dialog>
  );
}
