import type { ComponentType } from 'react';
import { entryName } from '../../connectors/types';
import type { Feature } from '../../model/features';
import type { PromptSort } from '../../model/prompt';
import type { PrereadParts } from '../../model/settings';
import { illustrateSwitches, setIllustrate, setTranslate, setTranslatorNote, translateSwitches } from '../../runtime/characters';
import { SHARED_CHAT, availableFeatures } from '../../runtime/features';
import { setAgentAt } from '../../runtime/agents';
import { briefsWithChatModel, briefWriterOf, PREREAD_STARTS, prereadSetup, setPreread } from '../../runtime/preread';
import { describePrereadFailure } from '../common/failure';
import { sceneWriterOf } from '../../runtime/illustrate';
import { prereadPrompt, setDefaultPrompt } from '../../runtime/prompts';
import { sendsNotes, translatorOf } from '../../runtime/translate';
import { AgentSwitches } from '../common/AgentSwitches';
import { DetailFold } from '../common/DetailFold';
import { IllustrateRows } from '../common/IllustrateRows';
import { Missing } from '../common/Missing';
import { TaskModelRow, TaskPromptMenu, type PromptDoor } from '../common/TaskPrompt';
import { TranslateRows } from '../common/TranslateRows';
import { TranslatorNoteField } from '../common/TranslatorNoteField';
import { useTypedNumber } from '../common/typed';
import { readWhole } from '../common/typedNumber';
import { AGENTS_HELP, FEATURE_NAMES, MODEL_ROLES, MODEL_SETTINGS, NOTE_UNSENT, noteLines, PAGES, PRE_READ, PRE_READ_HELP, PRE_READ_PARTS } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Callout, NavBar, NumberInput, Screen, SettingGroup, SettingRow, Switch } from '../ui';
import { FEATURE_HELP, FeatureSwitch } from './FeatureDefaults';

import { MemoryDefaults } from './MemoryDefaults';

// Without a prompt to open, the list opens on the feature's own sort.
const editPrompt = (sort: PromptSort) => (door: PromptDoor) => navigate(door ? { kind: 'prompt', ...door } : { kind: 'prompts', place: null, sort });

export function FeatureScreen({ feature, back }: { feature: Feature; back: Back }) {
  const available = availableFeatures(useSettings()).includes(feature);
  const name = FEATURE_NAMES[feature];
  const Defaults = DEFAULTS[feature];
  if (!available) return <Missing what="feature" back={back} />;
  return (
    <Screen width="form" top={<NavBar title={name} subtitle={PAGES.chat} {...backBar(back)} />}>
      <SettingGroup label={name}>
        <SettingRow label={name} help={feature === 'preread' ? `${PRE_READ_HELP} ${FEATURE_HELP}` : feature === 'agents' ? `${AGENTS_HELP} ${FEATURE_HELP}` : FEATURE_HELP} control={<FeatureSwitch feature={feature} />} />
      </SettingGroup>
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
        onChange={(change) => void setTranslate(store, null, change).then((saved) => saved.ok || toast.failed(saved))}
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
      onChange={(change) => void setIllustrate(store, null, change).then((saved) => saved.ok || toast.failed(saved))}
      onEditPrompt={editPrompt('illustrate')}
    />
  );
}

// The mascot's prompt is the account's default alone (design §6.11): picking one here makes it the default.
function MascotDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  // chosenPrompt reads these.
  usePrompts();
  return (
    <SettingGroup label={FEATURE_NAMES.mascot}>
      <SettingRow
        label="마스코트 프롬프트"
        help={`응답마다 ${MODEL_ROLES.aux}을 추가로 한 번 호출해요.`}
        control={
          <TaskPromptMenu
            task="mascot"
            chosen={settings.mascotPrompt}
            heading="모든 채팅에 적용돼요."
            opens="down"
            onPick={(prompt) => void setDefaultPrompt(store, prompt!).then((saved) => saved.ok || toast.failed(saved))}
            onEdit={editPrompt('mascot')}
          />
        }
      />
    </SettingGroup>
  );
}

const PART_HELP: Partial<Record<keyof PrereadParts, string>> = { system: '시스템 프롬프트를 요약하면 출력 형식이나 세부 지시사항이 잘 지켜지지 않을 수 있어요.' };

function CountRow({ label, unit, help, value, start, onChange }: { label: string; unit: string; help: string; value: number; start: number; onChange: (value: number) => void }) {
  const count = useTypedNumber(readWhole, value, { error: '0 이상의 정수를 입력해 주세요.', onChange });
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
  const choice = prereadPrompt(store);
  const writer = briefWriterOf(store, SHARED_CHAT);
  const setup = prereadSetup(store);
  const set = [setup.recent !== PREREAD_STARTS.recent, setup.batch !== PREREAD_STARTS.batch, setup.thinkLess !== PREREAD_STARTS.thinkLess].filter(Boolean).length;
  const save = (change: Parameters<typeof setPreread>[1]) => void setPreread(store, change).then((saved) => saved.ok || toast.failed(saved));
  return (
    <>
      {briefsWithChatModel(store, SHARED_CHAT) && (
        <Callout tone="warn" action={{ label: `${PRE_READ} 모델 선택`, onClick: () => editPrompt('preread')(choice.kind === 'prompt' ? { id: choice.prompt.id, pane: 'model' } : null) }}>
          {`${PRE_READ} 모델이 ${MODEL_ROLES.main}과 같아요. 이러면 비용이 오히려 늘 수 있어요.`}
        </Callout>
      )}
      <SettingGroup label={PRE_READ}>
        <TaskModelRow label={`${PRE_READ} 모델`} noun={PRE_READ} choice={choice} model={'kind' in writer ? describePrereadFailure(writer) : entryName(writer.route.model)} onEdit={editPrompt('preread')} />
      </SettingGroup>
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
      <DetailFold set={set}>
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
          help={`응답마다 ${MODEL_ROLES.aux}을 추가로 호출해요. ${PRE_READ} 프롬프트에서 다른 모델을 선택할 수 있어요.`}
          control={
            <TaskPromptMenu
              task="preread"
              chosen={settings.prereadPrompt}
              heading="모든 채팅에 적용돼요."
              opens="down"
              onPick={(prompt) => void setDefaultPrompt(store, prompt!).then((saved) => saved.ok || toast.failed(saved))}
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
