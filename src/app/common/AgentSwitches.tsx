import { inheritedAgents, setAgentAt, type AgentOwner } from '../../runtime/agents';
import { ofSort } from '../../runtime/prompts';
import { useLibrary, usePrompts, useSettings, useStore } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { Button, Empty, Section, SettingGroup, SettingRow, Switch, Text } from '../ui';
import { useLab } from './labs';
import { AGENTS, promptName, SCOPE, STAGE_NAMES } from './words';

const WORKS: Record<AgentOwner['kind'], string> = {
  settings: '켜 둔 에이전트는 모든 채팅에서 실행돼요.',
  prompt: '켜 둔 에이전트는 이 프롬프트를 쓰는 채팅에서 실행돼요.',
  character: '켜 둔 에이전트는 이 캐릭터의 모든 채팅에서 실행돼요.',
  chat: '켜 둔 에이전트는 이 채팅에서만 실행돼요.',
};
const STACKS = '다른 곳에서 켠 에이전트도 함께 실행돼요. 후처리 에이전트는 켠 순서대로 이어서 응답을 다듬어요.';
const FROM = { settings: SCOPE.default, prompt: '프롬프트', character: '캐릭터' } as const;

// own: the owner's list as stored. Lists stack (design §6.16): one a farther layer holds shows as on there, and is
// turned off only there.
export function AgentSwitches({ owner, own }: { owner: AgentOwner; own: string[] }) {
  const store = useStore();
  const toast = useToast();
  // Subscribed for inheritedAgents, which reads the farther layers from the store.
  useSettings();
  useLibrary();
  const agents = usePrompts().filter((prompt) => ofSort(prompt, 'agent'));
  const lab = useLab('agents');
  if (!lab) return null;
  const held = owner.kind === 'settings' ? new Map<string, keyof typeof FROM>() : inheritedAgents(store, owner);

  async function change(agent: string, on: boolean) {
    const saved = await setAgentAt(store, owner, agent, on);
    if (!saved.ok) toast.failed(saved, '저장하지 못했어요.');
  }

  const making = (
    <Button variant="secondary" onClick={() => navigate({ kind: 'prompts', place: null, sort: 'agent' })}>
      {`프롬프트에서 ${AGENTS} 만들기`}
    </Button>
  );
  if (agents.length === 0) return owner.kind === 'settings' ? <Empty action={making}>{`${AGENTS}가 없어요. 프롬프트의 ${AGENTS} 탭에서 만들어요.`}</Empty> : null;
  return (
    <Section level={owner.kind === 'chat' ? 3 : undefined} title={AGENTS} help={`${WORKS[owner.kind]} ${STACKS}`}>
      <SettingGroup label={AGENTS}>
        {agents.map(({ id, value }) => {
          const from = held.get(id);
          return (
            <SettingRow
              key={id}
              label={promptName(value.name)}
              sub={STAGE_NAMES[value.stage]}
              control={from ? <Text variant="note">{`${FROM[from]}에서 켜짐`}</Text> : <Switch label={promptName(value.name)} checked={own.includes(id)} onChange={(on) => void change(id, on)} />}
            />
          );
        })}
      </SettingGroup>
    </Section>
  );
}
