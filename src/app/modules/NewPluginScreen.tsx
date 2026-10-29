import { Code2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import type { Cost } from '../../connectors/types';
import { addDraftAsk, blankPlugin, createDraft } from '../../runtime/tools/drafts';
import { askEstimate, askPlugin, type PluginAsked } from '../../runtime/tools/plugin-writer';
import { sharedModel } from '../../runtime/assignment';
import { newOf } from '../common/acts';
import { describeAskFailure } from '../common/failure';
import { ModelMenu } from '../common/ModelMenu';
import { cost } from '../common/receipt';
import { STOP, TOOL } from '../common/words';
import { useConnections, useSession } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, CommentBox, NavBar, Row, Screen, Section, Stack } from '../ui';
import { isPlace, PLACES, StudioPlaces } from './StudioPlaces';

type Run = { kind: 'idle' } | { kind: 'running'; length: number } | { kind: 'failed'; message: string };

export function NewPluginScreen({ place, back }: { place: string | null; back: Back }) {
  const session = useSession();
  const { store, username } = session;
  useConnections();
  const toast = useToast();
  const [ask, setAsk] = useState(isPlace(place) ? PLACES[place].ask : '');
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [estimate, setEstimate] = useState<Cost | null>(null);
  const [picked, setPicked] = useState<ModelRef | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const route = sharedModel(store, 'main', picked);
  const ready = !('kind' in route);
  const running = run.kind === 'running';

  useEffect(() => {
    if (!ready || !ask.trim()) return setEstimate(null);
    let current = true;
    const timer = setTimeout(() => void askEstimate(session, { file: null, ask, model: picked }).then((found) => current && setEstimate(found)), 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [session, ready, ask, picked]);

  async function make() {
    const controller = new AbortController();
    abort.current = controller;
    setRun({ kind: 'running', length: 0 });
    const asked: PluginAsked = await askPlugin(session, { file: null, ask, model: picked }, controller.signal, (text) => setRun({ kind: 'running', length: text.length }));
    abort.current = null;
    if (!asked.ok) return setRun(asked.failure.kind === 'stopped' ? { kind: 'idle' } : { kind: 'failed', message: describeAskFailure(asked.failure) });
    if (!asked.answer.ok) return setRun({ kind: 'failed', message: `응답에 코드가 없어요. ${asked.answer.note}`.trim() });
    const id = crypto.randomUUID();
    const made = await createDraft(store, asked.answer.file, id);
    const kept = made.ok && (await addDraftAsk(store, id, { ask, note: asked.answer.note, model: asked.model, cost: asked.cost, at: Date.now() }, null));
    if (!made.ok || !kept || !kept.ok) {
      setRun({ kind: 'idle' });
      return toast.show(`${TOOL} 초안을 저장하지 못했어요.`);
    }
    navigate({ kind: 'plugin-draft', id }, { replace: true });
  }

  async function blank() {
    const id = crypto.randomUUID();
    const made = await createDraft(store, blankPlugin(username), id);
    if (!made.ok) return toast.show(`${TOOL} 초안을 만들지 못했어요.`);
    navigate({ kind: 'plugin-draft', id }, { replace: true });
  }

  const hint = running ? `생성 중… ${run.length.toLocaleString()}자` : estimate === null ? undefined : `예상 ${cost(estimate)}`;
  return (
    <Screen width="form" top={<NavBar title={newOf(TOOL)} {...backBar(back)} />}>
      <Stack gap="section">
        <Section title="어떤 플러그인을 만들까요?" help={`AI가 헤이젤 ${TOOL} 초안을 만들어요. 적용하기 전까지는 채팅에서 작동하지 않아요.`}>
          <Stack gap="related">
            <CommentBox
              label="만들 플러그인"
              value={ask}
              onChange={setAsk}
              placeholder="예: 응답마다 글자 수를 배지로 달아 줘"
              hint={hint}
              actions={
                <>
                  <ModelMenu route={route} onPick={setPicked} />
                  {running ? (
                    <Button variant="secondary" onClick={() => abort.current?.abort()}>{STOP}</Button>
                  ) : (
                    <Button variant="primary" disabled={!ready || !ask.trim()} onClick={() => void make()}>만들기</Button>
                  )}
                </>
              }
            />
            {run.kind === 'failed' && <Callout tone="warn">{run.message}</Callout>}
          </Stack>
        </Section>
        <Section title={`헤이젤 ${TOOL}으로 할 수 있는 일`}>
          <StudioPlaces onPick={(picked) => setAsk(PLACES[picked].ask)} />
        </Section>
        <Row kind="actions">
          <Button variant="link" icon={Code2} disabled={running} onClick={() => void blank()}>빈 파일로 시작</Button>
        </Row>
      </Stack>
    </Screen>
  );
}
