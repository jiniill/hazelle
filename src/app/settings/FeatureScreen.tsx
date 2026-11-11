import type { ComponentType } from 'react';
import type { Feature } from '../../model/features';
import type { PromptSort } from '../../model/prompt';
import type { PrereadParts } from '../../model/settings';
import { illustrateSwitches, setIllustrate, setTranslate, setTranslatorNote, translateSwitches } from '../../runtime/library/characters';
import { SHARED_CHAT, availableFeatures, setFeatureAt, sharedFeatures } from '../../runtime/tasks/features';
import { setAgentAt } from '../../runtime/tasks/agents';
import { briefsWithChatModel, briefWriterOf, PREREAD_STARTS, prereadSetup, setPreread } from '../../runtime/tasks/preread';
import { describeMascotFailure, describePrereadFailure } from '../common/failure';
import { sceneWriterOf } from '../../runtime/tasks/illustrate';
import { mascotWriterOf } from '../../runtime/tasks/mascot';
import { setDefaultPrompt } from '../../runtime/library/prompts';
import { sendsNotes, translatorOf } from '../../runtime/tasks/translate';
import { AgentSwitches } from '../common/AgentSwitches';
import { aliased } from '../common/alias';
import { DetailFold } from '../common/DetailFold';
import { IllustrateRows } from '../common/IllustrateRows';
import { Missing } from '../common/Missing';
import { AccountTaskModel, appliesTo, TaskPromptMenu, type PromptDoor } from '../common/TaskPrompt';
import { taskRuns } from '../common/taskRuns';
import { TranslateRows } from '../common/TranslateRows';
import { TranslatorNoteField } from '../common/TranslatorNoteField';
import { useTypedNumber } from '../common/typed';
import { readWhole } from '../common/typedNumber';
import { AGENTS_HELP, EVERY_CHAT, FEATURE_NAMES, MODEL_ROLES, MODEL_SETTINGS, NOTE_UNSENT, noteLines, PICTURE_PLACE, PRE_READ, PRE_READ_HELP, PRE_READ_PARTS, SAVE_FAILED, TASK_MODELS } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore, useStored } from '../session';
import { backBar, navigate, useAddress } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, NavBar, NumberInput, Screen, seekRow, SettingGroup, SettingRow, Switch } from '../ui';

import { MemoryDefaults } from './MemoryDefaults';

// 공용's availability, the bottom rung of the 기능 ladder: a switch with no layer above it to follow.
function FeatureSwitch({ feature }: { feature: Feature }) {
  const store = useStore();
  const toast = useToast();
  // Subscribed for sharedFeatures, which reads the settings from the store.
  useSettings();
  return <Switch variant="labeled" label="채팅에서 쓰기" checked={sharedFeatures(store)[feature]} onChange={(on) => toast.settled(setFeatureAt(store, { kind: 'settings' }, feature, on), SAVE_FAILED)} />;
}

// Over a chat whose character keeps 번역 or 삽화 of its own (캐릭터별 설정), this page's values do not reach that chat:
// said here, since a change made for it would seem to do nothing.
const APART = { translate: translateSwitches, illustrate: illustrateSwitches };
function Apart({ feature }: { feature: keyof typeof APART }) {
  const store = useStore();
  const { under } = useAddress();
  const chat = useStored('chat', under?.kind === 'chat' ? under.id : null);
  // A new chat is not stored until its first send; its address names its character.
  const character = useStored('character', under?.kind === 'new-chat' ? under.character : (chat?.value.character ?? null));
  if (!character || !APART[feature](store, character.id).own) return null;
  return <Callout tone="tip">{`${aliased(character.value.card.name, character.value.alias)}의 채팅은 캐릭터별 설정을 써요. 이 화면은 ${appliesTo(null, false)}`}</Callout>;
}

// What the feature is, for the two whose name does not say it.
const HEAD_HELP: Partial<Record<Feature, string>> = { preread: PRE_READ_HELP, agents: AGENTS_HELP };

// Without a prompt to open, the list opens on the feature's own sort.
const editPrompt = (sort: PromptSort) => (door: PromptDoor) => navigate(door ? { kind: 'prompt', ...door } : { kind: 'prompts', place: null, sort });

export function FeatureScreen({ feature, back }: { feature: Feature; back: Back | null }) {
  const available = availableFeatures(useSettings()).includes(feature);
  const name = FEATURE_NAMES[feature];
  const Defaults = DEFAULTS[feature];
  if (!available) return <Missing what="feature" back={back} />;
  return (
    <Screen width="form" top={<NavBar title={name} help={HEAD_HELP[feature]} {...backBar(back)} actions={<FeatureSwitch feature={feature} />} />}>
      {feature in APART && <Apart feature={feature as keyof typeof APART} />}
      <Defaults />
    </Screen>
  );
}

function TranslateDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // translatorOf reads these too.
  usePrompts();
  useConnections();
  const translation = translatorOf(store, SHARED_CHAT);
  const unsent = noteLines(settings.translatorNote) > 0 && translation.ok && !sendsNotes(translation.prompt);
  return (
    <>
      <TranslateRows
        translate={translateSwitches(store, null)}
        translation={translation}
        card={null}
        opens="down"
        onChange={(change) => toast.settled(setTranslate(store, null, change))}
        onEditPrompt={editPrompt('translate')}
      />
      <TranslatorNoteField
        saveKey="translator-note"
        stored={settings.translatorNote}
        write={(note) => setTranslatorNote(store, null, note)}
        help="모든 캐릭터의 번역에 적용돼요."
        error={unsent ? NOTE_UNSENT : undefined}
      />
    </>
  );
}

function IllustrateDefaults() {
  const store = useStore();
  const toast = useToast();
  // illustrateSwitches and sceneWriterOf read these.
  useSettings();
  usePrompts();
  useConnections();
  useProfiles();
  return (
    <IllustrateRows
      illustrate={illustrateSwitches(store, null)}
      sceneWriter={sceneWriterOf(store, SHARED_CHAT)}
      card={null}
      opens="down"
      onChange={(change) => toast.settled(setIllustrate(store, null, change))}
      onEditPrompt={editPrompt('illustrate')}
    >
      <SettingRow
        label={PICTURE_PLACE}
        control={
          <Button variant="secondary" size="sm" onClick={openPicturePlace}>
            보기
          </Button>
        }
      />
    </IllustrateRows>
  );
}

// Where a picture stands is 디스플레이's, on this device; the 삽화 page only leads there.
const openPicturePlace = () => {
  navigate({ kind: 'display' });
  seekRow(PICTURE_PLACE);
};

// The mascot's prompt is the account's default alone (design §6.11): picking one here makes it the default.
function MascotDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // chosenPrompt and mascotWriterOf read these.
  usePrompts();
  useConnections();
  useProfiles();
  const writer = mascotWriterOf(store, SHARED_CHAT);
  return (
    <SettingGroup label={FEATURE_NAMES.mascot}>
      <AccountTaskModel task="mascot" help="응답마다 모델을 한 번 더 호출해요." runs={taskRuns(writer, describeMascotFailure)} />
      <SettingRow
        label="마스코트 프롬프트"
        control={
          <TaskPromptMenu
            task="mascot"
            chosen={settings.mascotPrompt}
            heading={EVERY_CHAT}
            opens="down"
            onPick={(prompt) => toast.settled(setDefaultPrompt(store, prompt!))}
            onEdit={editPrompt('mascot')}
          />
        }
      />
    </SettingGroup>
  );
}

const PART_HELP: Partial<Record<keyof PrereadParts, string>> = { system: '시스템 프롬프트를 요약하면 출력 형식이나 세부 지시사항이 잘 지켜지지 않을 수 있어요.' };

function CountRow({ label, unit, help, value, start, onChange }: { label: string; unit: string; help: string; value: number; start: number; onChange: (value: number) => void }) {
  const count = useTypedNumber(readWhole, value, { onChange });
  return (
    <SettingRow
      label={label}
      help={help}
      changed={value !== start}
      error={count.error}
      control={<NumberInput label={label} unit={unit} value={count.text} invalid={count.error !== undefined} onChange={count.change} />}
    />
  );
}

// The account's alone, as the mascot's prompt is: picking a prompt here makes it the default.
function PrereadDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // chosenPrompt and briefWriterOf read these.
  usePrompts();
  useConnections();
  useProfiles();
  const writer = briefWriterOf(store, SHARED_CHAT);
  const setup = prereadSetup(store);
  const set = [setup.recent !== PREREAD_STARTS.recent, setup.batch !== PREREAD_STARTS.batch, setup.thinkLess !== PREREAD_STARTS.thinkLess].filter(Boolean).length;
  const save = (change: Parameters<typeof setPreread>[1]) => toast.settled(setPreread(store, change));
  return (
    <>
      {briefsWithChatModel(store, SHARED_CHAT) && (
        <Callout tone="warn" action={{ label: `${TASK_MODELS.preread} 선택`, onClick: () => seekRow(TASK_MODELS.preread) }}>
          {`${TASK_MODELS.preread}이 ${MODEL_ROLES.main}과 같아요. 이러면 비용이 오히려 늘 수 있어요.`}
        </Callout>
      )}
      <SettingGroup label={PRE_READ}>
        <AccountTaskModel task="preread" runs={taskRuns(writer, describePrereadFailure)} />
      </SettingGroup>
      <DetailFold
        set={set}
        above={
          <SettingGroup label="요약할 대상">
            {(Object.entries(PRE_READ_PARTS) as [keyof PrereadParts, string][]).map(([part, label]) => (
              <SettingRow
                key={part}
                label={label}
                help={PART_HELP[part]}
                changed={setup.parts[part] !== PREREAD_STARTS.parts[part]}
                control={<Switch label={label} checked={setup.parts[part]} onChange={(on) => save({ parts: { ...setup.parts, [part]: on } })} />}
              />
            ))}
          </SettingGroup>
        }
      >
        <CountRow label="원문으로 유지할 최근 대화" unit="개" help="마지막으로 보낸 내 메시지는 이 수와 상관없이 그대로 보내요." value={setup.recent} start={PREREAD_STARTS.recent} onChange={(recent) => save({ recent })} />
        <CountRow label="한 번에 요약할 분량" unit="토큰" help="요약할 내용이 이만큼 쌓이면 그때 요약해요. 그보다 적으면 원문 그대로 보내요." value={setup.batch} start={PREREAD_STARTS.batch} onChange={(batch) => save({ batch })} />
        <SettingRow
          label="추론 최소화"
          help={`끄면 해당 모델의 ${MODEL_SETTINGS}을 그대로 사용해요.`}
          changed={setup.thinkLess !== PREREAD_STARTS.thinkLess}
          control={<Switch label="추론 최소화" checked={setup.thinkLess} onChange={(thinkLess) => save({ thinkLess })} />}
        />
        <SettingRow
          label={`${PRE_READ} 프롬프트`}
          control={
            <TaskPromptMenu
              task="preread"
              chosen={settings.prereadPrompt}
              heading={EVERY_CHAT}
              opens="down"
              onPick={(prompt) => toast.settled(setDefaultPrompt(store, prompt!))}
              onEdit={editPrompt('preread')}
            />
          }
        />
      </DetailFold>
    </>
  );
}

function AgentDefaults() {
  const store = useStore();
  return <AgentSwitches owner={{ kind: 'settings' }} own={useSettings().agents ?? []} onChange={(agent, on) => setAgentAt(store, { kind: 'settings' }, agent, on)} />;
}

const DEFAULTS: Record<Feature, ComponentType> = { translate: TranslateDefaults, illustrate: IllustrateDefaults, memory: MemoryDefaults, mascot: MascotDefaults, preread: PrereadDefaults, agents: AgentDefaults };
