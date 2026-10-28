import type { PromptSort } from '../../model/prompt';
import { ofSort, translationPrompt, illustrationPrompt, mascotPrompt, prereadPrompt, type PromptChoice } from '../../runtime/prompts';
import type { ObjectStore } from '../../runtime/store';
import type { PromptPane } from '../shell/routes';
import { byPromptName } from './promptCopies';
import { defaultMark, DELETED_PROMPT, follows, PRE_READ, taskModelHelp } from './words';
import { useSession, useSettings, usePrompts } from '../session';
import { ChipButton, Divider, Menu, MenuHeading, MenuItem, SettingRow, Switch, Tag, Text } from '../ui';
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
  translate: { noun: '번역', setting: 'translatePrompt', choose: translationPrompt, pane: null, switches: true },
  illustrate: { noun: '삽화', setting: 'illustratePrompt', choose: illustrationPrompt, pane: 'picture', switches: true },
  mascot: { noun: '마스코트', setting: 'mascotPrompt', choose: mascotPrompt, pane: null, switches: false },
  preread: { noun: PRE_READ, setting: 'prereadPrompt', choose: prereadPrompt, pane: null, switches: false },
} as const;

// The prompt a task's switches run, by name; a deleted or absent one is named as such, never as another prompt.
export function chosenPrompt(store: Reader, task: keyof typeof TASKS, chosen: string | undefined) {
  const { noun, choose } = TASKS[task];
  const choice = choose(store, chosen);
  const missing = `기본 ${noun} 프롬프트 없음`;
  return { choice, missing, label: choice.kind === 'prompt' ? choice.prompt.value.name : choice.own ? DELETED_PROMPT : missing };
}

// Without its own choice the switches follow the task's default prompt live.
export function TaskPromptMenu({ task, chosen, heading, opens, onPick, onEdit }: { task: keyof typeof TASKS; chosen: string | undefined; heading: string; opens: 'up' | 'down'; onPick: (prompt: string | undefined) => void; onEdit: (door: PromptDoor) => void }) {
  const { noun, setting, pane, switches } = TASKS[task];
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
      label={`${noun} 프롬프트`}
      trigger={(opener) => <ChipButton variant="field" opens={opens} label={label} title={`${noun} 프롬프트`} tone={choice.kind === 'missing' ? 'warn' : 'plain'} {...opener} />}
    >
      <MenuHeading>{heading}</MenuHeading>
      {switches && <MenuItem label={follows(`기본 ${noun} 프롬프트`)} sub={fallback?.value.name ?? missing} checked={chosen === undefined} onClick={() => onPick(undefined)} />}
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

export function TaskModelRow<S extends PromptSort>({ label, noun, choice, sub, model, onEdit }: { label: string; noun: string; choice: PromptChoice<S>; sub?: string; model: string; onEdit: (door: PromptDoor) => void }) {
  const help = taskModelHelp(noun, choice.kind === 'prompt');
  return (
    <SettingRow
      label={label}
      help={{ text: help.text, open: { label: help.door, onClick: () => onEdit(choice.kind === 'prompt' ? { id: choice.prompt.id, pane: 'model' } : null) } }}
      sub={sub}
      control={<Text variant="note">{model}</Text>}
    />
  );
}
