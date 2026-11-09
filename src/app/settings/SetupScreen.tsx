import { useMemo, useState, type ReactNode } from 'react';
import type { Role } from '../../connectors/assignment';
import { setDefaultModel } from '../../runtime/assignment';
import { setIllustrate, setTranslate } from '../../runtime/characters';
import { availableFeatures } from '../../runtime/features';
import { overviewOf, type TaskRun } from '../../runtime/overview';
import { findStarred, RolePicker } from '../common/RolePicker';
import { AccountTaskModel, TaskModelRow } from '../common/TaskPrompt';
import { AUX_HELP, DEFAULT_MODELS_FAILED, EMBED_HELP, FINDINGS, follows, inFeature, inSettings, MAIN_HELP, MODEL_ROLES, NOT_PICKED, NOT_STARRED, opens, PAGES, SCOPE, TASK_MODELS, PROMPT_MODELS } from '../common/words';
import { useCaptured, useConnections, useSettings, useStore, useStored } from '../session';
import { backBar, navigate, useAddress } from '../shell/router';
import type { Back, Route } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, FlowMap, List, ListItem, NavBar, Row, Screen, Section, SettingGroup } from '../ui';
import { findingsOf, LEGEND, mapOf, taskRuns, type Target } from './setup';

const HERE = '이 채팅';
const ROLE_ROWS: Record<Role, { help: string; follow: string | null }> = {
  main: { help: MAIN_HELP, follow: null },
  aux: { help: AUX_HELP, follow: follows(MODEL_ROLES.main) },
  embed: { help: EMBED_HELP, follow: NOT_PICKED },
};

// 공용, or the chat the settings stand over: what it runs on as its own layers resolve it.
function useScope() {
  const { under } = useAddress();
  const chat = under?.kind === 'chat' ? under.id : null;
  const [scope, setScope] = useState<'shared' | 'chat'>('shared');
  const stored = useStored('chat', scope === 'chat' ? chat : null);
  const pick = chat && <ChoiceGroup label="범위" layout="segmented" options={[{ value: 'shared', label: SCOPE.default }, { value: 'chat', label: HERE }]} value={scope} onChange={setScope} />;
  return { chat: scope === 'chat' ? (stored?.value ?? null) : null, shared: scope === 'shared' || !stored, pick };
}

export function SetupScreen({ back }: { back: Back | null }) {
  const settings = useSettings();
  const connections = useConnections();
  const scope = useScope();
  const overview = useCaptured((store) => overviewOf(store, scope.chat), [scope.chat]);
  const [picked, setPicked] = useState<string | null>(null);
  const { findings, map } = useMemo(() => {
    const available = availableFeatures(settings);
    const findings = findingsOf(overview, available);
    return { findings, map: mapOf(overview, connections, available, findings) };
  }, [overview, connections, settings]);
  const target = picked === null ? undefined : map.targets.get(picked);
  const title = map.columns.flatMap(({ nodes }) => nodes).find(({ id }) => id === picked);

  return (
    <Screen width="page" top={<NavBar title={PAGES.setup} {...backBar(back)} actions={scope.pick} />}>
      {findings.length > 0 && (
        <Section title={FINDINGS} note={`${findings.length}개`}>
          <List label={FINDINGS} box>
            {findings.map(({ node, title, why }) => (
              <ListItem key={`${node}/${why}`} title={title} description={why} onClick={() => setPicked(node)} />
            ))}
          </List>
        </Section>
      )}
      <FlowMap
        label={PAGES.setup}
        columns={map.columns}
        edges={map.edges}
        picked={target ? picked : null}
        onPick={setPicked}
        legend={LEGEND}
        detail={
          target &&
          title && (
            <Section title={title.lead ?? title.title} level={3}>
              {findings
                .filter(({ node }) => node === picked)
                .map(({ why }) => (
                  <Callout key={why} tone="warn">
                    {why}
                  </Callout>
                ))}
              <Detail target={target} shared={scope.shared} />
            </Section>
          )
        }
      />
    </Screen>
  );
}

// 공용's pickers where the page shows 공용; a chat's own choices are made in the chat, so its detail only leads on.
function Detail({ target, shared }: { target: Target; shared: boolean }) {
  switch (target.kind) {
    case 'connection':
      return <Door label={opens(PAGES.connections)} to={{ kind: 'connection', id: target.connection.id }} />;
    case 'model':
      return <Door label={opens(target.name)} to={{ kind: 'model', ...target.ref }} />;
    case 'role':
      return (
        <>
          {shared && (
            <SettingGroup label={MODEL_ROLES[target.role]}>
              <DefaultModel role={target.role} />
            </SettingGroup>
          )}
          <Door label={opens(inSettings('models'))} to={{ kind: 'models' }} />
        </>
      );
    case 'talk':
      return (
        <>
          {shared && (
            <SettingGroup label={PAGES.chat}>
              <DefaultModel role="main" />
            </SettingGroup>
          )}
          {shared && <Pins pins={target.pins} />}
          <Door label={opens(inSettings('chat'))} to={{ kind: 'chat-settings' }} />
        </>
      );
    case 'task':
      return (
        <>
          {shared && (
            <SettingGroup label={TASK_MODELS[target.task.feature]}>
              <TaskModel task={target.task} />
            </SettingGroup>
          )}
          <Door label={opens(inFeature(target.task.feature))} to={{ kind: 'feature', feature: target.task.feature }} />
        </>
      );
  }
}

function Door({ label, to }: { label: string; to: Route }): ReactNode {
  return (
    <Row kind="actions">
      <Button variant="secondary" size="sm" onClick={() => navigate(to)}>
        {label}
      </Button>
    </Row>
  );
}

function DefaultModel({ role }: { role: Role }) {
  const store = useStore();
  const toast = useToast();
  const own = useSettings().models[role];
  return (
    <RolePicker
      role={role}
      help={ROLE_ROWS[role].help}
      own={own}
      follow={ROLE_ROWS[role].follow}
      connections={useConnections()}
      onPick={(ref) => toast.settled(setDefaultModel(store, role, ref), DEFAULT_MODELS_FAILED)}
    />
  );
}

// The conversation prompts that talk on a 대화 모델 of their own, each opening at its 모델 pane.
function Pins({ pins }: { pins: Extract<Target, { kind: 'talk' }>['pins'] }) {
  const connections = useConnections();
  return (
    pins.length > 0 && (
      <List label={PROMPT_MODELS} box>
        {pins.map(({ prompt, ref }) => (
          <ListItem key={prompt.id} title={prompt.value.name} note={findStarred(ref, connections)?.name ?? NOT_STARRED} onClick={() => navigate({ kind: 'prompt', id: prompt.id, pane: 'model' })} />
        ))}
      </List>
    )
  );
}

function TaskModel({ task }: { task: TaskRun }) {
  const store = useStore();
  const toast = useToast();
  const runs = taskRuns(task);
  switch (task.feature) {
    case 'translate':
      return <TaskModelRow label={TASK_MODELS.translate} own={task.own} runs={runs} onPick={(ref) => toast.settled(setTranslate(store, null, { model: ref ?? undefined }))} />;
    case 'illustrate':
      return <TaskModelRow label={TASK_MODELS.illustrate} own={task.own} runs={runs} onPick={(ref) => toast.settled(setIllustrate(store, null, { sceneModel: ref ?? undefined }))} />;
    default:
      return <AccountTaskModel task={task.feature} runs={runs} />;
  }
}
