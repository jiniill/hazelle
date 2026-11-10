import type { ModelRef } from '../../connectors/assignment';
import { entryName } from '../../connectors/types';
import { accountTaskModel, setAccountTaskModel, type AccountTask } from '../../runtime/models/assignment';
import { ofSort, translationPrompt, illustrationPrompt, mascotPrompt, prereadPrompt } from '../../runtime/library/prompts';
import type { ObjectStore } from '../../runtime/store/store';
import type { PromptPane } from '../shell/routes';
import { byPromptName } from './promptCopies';
import type { TaskRuns } from './taskRuns';
import { RolePicker } from './RolePicker';
import { defaultMark, DELETED_PROMPT, follows, MODEL_ROLES, SAVE_FAILED, TASK_MODELS } from './words';
import { defaultPrompt, SORT_PROMPT } from './prompt-words';
import { useConnections, useSession, useSettings, usePrompts } from '../session';
import { useToast } from '../toast';
import { ChipButton, Divider, Menu, MenuHeading, MenuItem, SettingRow, Switch, Tag } from '../ui';
type NamedCharacter = { name: string } | null;
type Reader = Pick<ObjectStore, 'get'>;
// A prompt and the editor pane a door names; null, the prompt list.
export type PromptDoor = { id: string; pane: PromptPane | null } | null;

export const appliesTo = (card: NamedCharacter, own: boolean) => (card && own ? `${card.name}의 채팅에만 적용돼요.` : '캐릭터별 설정이 없는 모든 채팅에 적용돼요.');

export function PerCharacter({ card, own, onChange }: { card: NamedCharacter; own: boolean; onChange: (own: boolean) => void }) {
  return (
    card && (
      <SettingRow
        label="캐릭터별 설정"
        help={`켜면 ${card.name}의 채팅에만 이 설정을 적용해요.`}
        control={<Switch label="캐릭터별 설정" checked={own} onChange={onChange} />}
      />
    )
  );
}

// Chat task switches override/follow defaults. Mascot/preread pick the account default directly,
// never a chat override (design §6.11).
const TASKS = {
  translate: { setting: 'translatePrompt', choose: translationPrompt, pane: null, switches: true },
  illustrate: { setting: 'illustratePrompt', choose: illustrationPrompt, pane: 'picture', switches: true },
  mascot: { setting: 'mascotPrompt', choose: mascotPrompt, pane: null, switches: false },
  preread: { setting: 'prereadPrompt', choose: prereadPrompt, pane: null, switches: false },
} as const;

// The prompt a task's switches run, by name; a deleted or absent one is named as such, never as another prompt.
export function chosenPrompt(store: Reader, task: keyof typeof TASKS, chosen: string | undefined) {
  const choice = TASKS[task].choose(store, chosen);
  const missing = `${defaultPrompt(task)} 없음`;
  return { choice, missing, label: choice.kind === 'prompt' ? choice.prompt.value.name : choice.own ? DELETED_PROMPT : missing };
}

// Without its own choice the switches follow the task's default prompt live.
export function TaskPromptMenu({ task, chosen, heading, opens, onPick, onEdit }: { task: keyof typeof TASKS; chosen: string | undefined; heading: string; opens: 'up' | 'down'; onPick: (prompt: string | undefined) => void; onEdit: (door: PromptDoor) => void }) {
  const { setting, pane, switches } = TASKS[task];
  const { store } = useSession();
  const settings = useSettings();
  const prompts = usePrompts()
    .filter((each) => ofSort(each, task))
    .sort(byPromptName);
  const { choice, label, missing } = chosenPrompt(store, task, chosen);
  const fallback = prompts.find(({ id }) => id === settings[setting]);
  return (
    <Menu
      place={opens === 'up' ? 'above-end' : 'below-end'}
      label={SORT_PROMPT[task]}
      trigger={(opener) => <ChipButton variant="field" opens={opens} label={label} title={SORT_PROMPT[task]} tone={choice.kind === 'missing' ? 'warn' : 'plain'} {...opener} />}
    >
      <MenuHeading>{heading}</MenuHeading>
      {switches && <MenuItem label={follows(defaultPrompt(task))} description={fallback?.value.name ?? missing} checked={chosen === undefined} onClick={() => onPick(undefined)} />}
      {prompts.map((item) => {
        const mark = defaultMark(item.id === settings[setting], item.value.name);
        return <MenuItem key={item.id} label={item.value.name} tag={mark && <Tag tone="accent">{mark}</Tag>} checked={item.id === chosen} onClick={() => onPick(item.id)} />;
      })}
      <Divider variant="menu" />
      {choice.kind === 'prompt' && <MenuItem label="이 프롬프트 편집" onClick={() => onEdit({ id: choice.prompt.id, pane })} />}
      <MenuItem label="프롬프트 관리" onClick={() => onEdit(null)} />
    </Menu>
  );
}

// A task's own model, else 보조 모델. runs: what the task runs on now, or why it cannot; said under the row while it
// follows 보조 모델 or fails.
export function TaskModelRow({ label, help, own, runs, onPick }: { label: string; help?: string; own: ModelRef | undefined; runs: TaskRuns; onPick: (ref: ModelRef | null) => void }) {
  const connections = useConnections();
  const description = 'why' in runs ? runs.why : own ? undefined : entryName(runs.route.model);
  return <RolePicker role="aux" label={label} help={help} own={own} follow={follows(MODEL_ROLES.aux)} description={description} connections={connections} onPick={onPick} />;
}

// 장기 기억's, 마스코트's and 토큰 절약's model, 공용's alone as their prompts are: a pick here holds for every chat.
export function AccountTaskModel({ task, help, runs }: { task: AccountTask; help?: string; runs: TaskRuns }) {
  const { store } = useSession();
  const toast = useToast();
  // Subscribed for accountTaskModel, which reads the settings from the store.
  useSettings();
  return <TaskModelRow label={TASK_MODELS[task]} help={help} own={accountTaskModel(store, task)} runs={runs} onPick={(ref) => toast.settled(setAccountTaskModel(store, task, ref), SAVE_FAILED)} />;
}
