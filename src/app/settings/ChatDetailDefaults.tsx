import { useState } from 'react';
import { RETRIES } from '../../connectors/registry';
import { RETRY_MOST } from '../../contracts/streams';
import { setDefaultModel } from '../../runtime/assignment';
import { ANSWER_INSTRUCTION, answerInstructionOf, LORE_SCAN, setAnswerInstruction, setSharedLoreScan, setToolRounds, sharedLoreScan } from '../../runtime/chat-context';
import { TOOL_ROUNDS } from '../../runtime/tool-loop';
import { setSharedRetries } from '../../runtime/connections';
import { RolePicker } from '../common/RolePicker';
import { filled, typedText, useTypedNumber } from '../common/typed';
import { count, readCount } from '../common/typedNumber';
import { useAutosave } from '../common/useAutosave';
import { ANSWER_INSTRUCTION_LABEL, CHAT_DETAIL, DEFAULT_MODELS, LORE_SCAN_WORDS, MAIN_HELP, MODEL_SETTINGS, RETRY_COUNT, RETRY_HELP } from '../common/words';
import { useConnections, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { NumberInput, Section, SettingGroup, SettingRow, Stepper, Switch, TextField } from '../ui';

export function ChatDetailDefaults() {
  const store = useStore();
  const toast = useToast();
  const { retries, toolRounds, loreBudget, loreDepth, loreRecursive, loreFullWord, answerInstruction, models } = useSettings();
  const connections = useConnections();
  const shared = sharedLoreScan(store);
  const flag = (key: 'recursive' | 'fullWordMatching', set: boolean | undefined) => (
    <SettingRow
      label={LORE_SCAN_WORDS[key].label}
      help={`${LORE_SCAN_WORDS[key].help} 기본값은 ${LORE_SCAN[key] ? '켜짐' : '꺼짐'}이에요.`}
      changed={set !== undefined}
      control={<Switch label={LORE_SCAN_WORDS[key].label} checked={shared[key]} onChange={(on) => toast.settled(setSharedLoreScan(store, key, on))} />}
    />
  );
  return (
    <>
      <Section title={CHAT_DETAIL.reply}>
        <SettingGroup label={CHAT_DETAIL.reply}>
          <RolePicker role="main" help={MAIN_HELP} own={models.main} follow={null} connections={connections} onPick={(ref) => ref && toast.settled(setDefaultModel(store, 'main', ref), `${DEFAULT_MODELS}을 바꾸지 못했어요.`)} />
          <SettingRow
            label={RETRY_COUNT}
            help={`${RETRY_HELP} API 연결이나 ${MODEL_SETTINGS}마다 따로 정할 수도 있어요.`}
            changed={retries !== undefined}
            control={
              <Stepper
                label={RETRY_COUNT}
                less="1회 줄이기"
                more="1회 늘리기"
                value={retries ?? RETRIES}
                min={0}
                max={RETRY_MOST}
                onChange={(next) => toast.settled(setSharedRetries(store, next))}
              />
            }
          />
          <SettingRow
            label={TOOL_ROUNDS_LABEL}
            help={`플러그인의 모델 도구를 쓸 때 응답 하나에 모델을 호출하는 최대 횟수예요. 기본값은 ${TOOL_ROUNDS}회예요.`}
            changed={toolRounds !== undefined}
            control={
              <Stepper
                label={TOOL_ROUNDS_LABEL}
                less="1회 줄이기"
                more="1회 늘리기"
                value={toolRounds ?? TOOL_ROUNDS}
                min={2}
                max={10}
                onChange={(next) => toast.settled(setToolRounds(store, next))}
              />
            }
          />
          <AnswerInstructionField changed={answerInstruction !== undefined} />
        </SettingGroup>
      </Section>
      <Section title={CHAT_DETAIL.lore}>
        <SettingGroup label={CHAT_DETAIL.lore}>
          <SharedLoreNumber field="tokenBudget" changed={loreBudget !== undefined} />
          {flag('recursive', loreRecursive)}
          <SharedLoreNumber field="scanDepth" changed={loreDepth !== undefined} />
          {flag('fullWordMatching', loreFullWord)}
        </SettingGroup>
      </Section>
    </>
  );
}

const TOOL_ROUNDS_LABEL = '모델 도구 호출 횟수';

function SharedLoreNumber({ field, changed }: { field: 'tokenBudget' | 'scanDepth'; changed: boolean }) {
  const store = useStore();
  const { label, help, unit, amount, is } = LORE_SCAN_WORDS[field];
  const save = useAutosave<{ value: number }>(`lore-${field}`, (patch) => setSharedLoreScan(store, field, patch.value!));
  const typed = useTypedNumber(readCount, save.unsaved.value ?? sharedLoreScan(store)[field], { onChange: (value) => save.change({ value }) });
  return (
    <SettingRow
      label={label}
      help={`${help} 기본값은 ${amount(count(LORE_SCAN[field]))}${is}.`}
      changed={changed}
      error={typed.error}
      control={<NumberInput label={label} unit={unit} value={typed.text} invalid={typed.error !== undefined} onChange={typed.change} />}
    />
  );
}

function AnswerInstructionField({ changed }: { changed: boolean }) {
  const store = useStore();
  const save = useAutosave<{ text: string }>('answer-instruction', (patch) => setAnswerInstruction(store, patch.text!));
  const [typed, setTyped] = useState<string>();
  const draft = typedText(typed, filled, save.unsaved.text ?? answerInstructionOf(store), (text) => text);
  const type = (next: string) => {
    setTyped(next);
    const text = filled(next);
    if (text !== null) save.change({ text });
  };
  return (
    <SettingRow
      label={ANSWER_INSTRUCTION_LABEL}
      help={`입력 없이 보내면 이 문장으로 다음 응답을 받아요. 기본값은 ${ANSWER_INSTRUCTION}이에요.`}
      changed={changed}
      error={filled(draft) === null ? '문장을 입력해 주세요.' : undefined}
      wide
      control={<TextField label={ANSWER_INSTRUCTION_LABEL} showLabel={false} lines={2} value={draft} onChange={type} />}
    />
  );
}
