import type { Assignment, ModelRef, Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { findStarred, RolePicker } from '../common/RolePicker';
import { AGENTS, AUX_HELP, DEFAULT_MODELS, follows, inSettings, MODEL_ROLES, MODEL_SETTINGS, NOT_STARRED, opens } from '../common/words';
import { navigate } from '../shell/router';
import { Section, SettingGroup, type Help } from '../ui';

const DEFAULTS = follows(DEFAULT_MODELS);
const AUX = follows(MODEL_ROLES.aux);

const nameOf = (ref: ModelRef, connections: readonly Stored<'connection'>[]) => findStarred(ref, connections)?.name ?? NOT_STARRED;

export function modelWords(models: Assignment, connections: readonly Stored<'connection'>[]): string {
  const main = models.main ? nameOf(models.main, connections) : DEFAULTS;
  return models.aux ? `${main} · ${MODEL_ROLES.aux} 별도 지정` : main;
}

export const agentModelWords = (own: ModelRef | undefined, connections: readonly Stored<'connection'>[]) => (own ? nameOf(own, connections) : AUX);

function tuning(picked: ModelRef | undefined, connections: readonly Stored<'connection'>[]): Help {
  const model = picked && findStarred(picked, connections);
  return {
    text: `온도 같은 값은 ${MODEL_SETTINGS}에서 정해요.`,
    open: model ? { label: opens(model.name), onClick: () => navigate({ kind: 'model', ...picked }) } : { label: opens(inSettings('models')), onClick: () => navigate({ kind: 'models' }) },
  };
}

type Props = { models: Assignment; defaults: Assignment; connections: readonly Stored<'connection'>[]; onPick: (role: Role, ref: ModelRef | null) => void };

export function ModelPane({ models, defaults, connections, onPick }: Props) {
  // Unset here, 보조 모델 takes 기본 모델's own 보조 모델 first, and only then 대화 모델.
  const follow = (role: Role) => (role === 'main' || defaults.aux ? DEFAULTS : follows(MODEL_ROLES.main));
  const picker = (role: Role, help?: string) => <RolePicker role={role} help={help} own={models[role]} follow={follow(role)} connections={connections} onPick={(ref) => onPick(role, ref)} />;
  return (
    <Section title="모델" help={tuning(models.main, connections)}>
      <SettingGroup label="모델">
        {picker('main')}
        {picker('aux', AUX_HELP)}
      </SettingGroup>
    </Section>
  );
}

type AgentProps = { own: ModelRef | undefined; connections: readonly Stored<'connection'>[]; onPick: (ref: ModelRef | null) => void };

// An agent's own model, which its prompt holds since the agent is its prompt; the other tasks' are their features'.
export function AgentModelPane({ own, connections, onPick }: AgentProps) {
  return (
    <Section title="모델" help={tuning(own, connections)}>
      <SettingGroup label="모델">
        <RolePicker role="aux" label={`${AGENTS} 모델`} own={own} follow={AUX} connections={connections} onPick={onPick} />
      </SettingGroup>
    </Section>
  );
}
