import { useState } from 'react';
import { RETRIES } from '../../connectors/registry';
import { RETRY_MOST } from '../../contracts/streams';
import { ANSWER_INSTRUCTION, answerInstructionOf, LORE_SCAN, setAnswerInstruction, setSharedLoreScan, setToolRounds, setUsageShown, sharedLoreScan } from '../../runtime/chat-context';
import { TOOL_ROUNDS } from '../../runtime/tool-loop';
import { setSharedRetries } from '../../runtime/connections';
import { DetailFold } from '../common/DetailFold';
import { filled, typedText, useTypedNumber } from '../common/typed';
import { count, readCount } from '../common/typedNumber';
import { useAutosave } from '../common/useAutosave';
import { ANSWER_INSTRUCTION_LABEL, CHAT_DETAIL, LORE_SCAN_WORDS, MODEL_SETTINGS, RETRY_COUNT, RETRY_HELP } from '../common/words';
import { useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { NumberInput, SettingRow, Stepper, Switch, TextField } from '../ui';

export function ChatDetailDefaults() {
  const store = useStore();
  const toast = useToast();
  const { retries, toolRounds, loreBudget, loreDepth, loreRecursive, loreFullWord, answerInstruction, usageShown } = useSettings();
  const shared = sharedLoreScan(store);
  const flag = (key: 'recursive' | 'fullWordMatching', set: boolean | undefined) => (
    <SettingRow
      label={LORE_SCAN_WORDS[key].label}
      help={`${LORE_SCAN_WORDS[key].help} 기본값은 ${LORE_SCAN[key] ? '켜짐' : '꺼짐'}이에요.`}
      changed={set !== undefined}
      control={<Switch label={LORE_SCAN_WORDS[key].label} checked={shared[key]} onChange={(on) => void setSharedLoreScan(store, key, on).then((result) => result.ok || toast.failed(result))} />}
    />
  );
  return (
    <DetailFold
      set={[retries, toolRounds, loreBudget, loreDepth, loreRecursive, loreFullWord, answerInstruction, usageShown].filter((value) => value !== undefined).length}
      sections={[
        {
          title: CHAT_DETAIL.reply,
          rows: (
            <>
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
                    onChange={(next) => void setSharedRetries(store, next).then((result) => result.ok || toast.failed(result))}
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
                    onChange={(next) => void setToolRounds(store, next).then((result) => result.ok || toast.failed(result))}
                  />
                }
              />
              <AnswerInstructionField changed={answerInstruction !== undefined} />
              <SettingRow
                label={USAGE_SHOWN}
                help="응답 아래에 비용과 토큰을 한 줄로 보여 줘요. 누르면 자세한 내용이 펼쳐져요."
                changed={usageShown !== undefined}
                control={<Switch label={USAGE_SHOWN} checked={usageShown !== undefined} onChange={(on) => void setUsageShown(store, on).then((result) => result.ok || toast.failed(result))} />}
              />
            </>
          ),
        },
        {
          title: CHAT_DETAIL.lore,
          rows: (
            <>
              <SharedLoreNumber field="tokenBudget" changed={loreBudget !== undefined} />
              {flag('recursive', loreRecursive)}
              <SharedLoreNumber field="scanDepth" changed={loreDepth !== undefined} />
              {flag('fullWordMatching', loreFullWord)}
            </>
          ),
        },
      ]}
    />
  );
}

const USAGE_SHOWN = '사용량 표시';
const TOOL_ROUNDS_LABEL = '모델 도구 호출 횟수';

function SharedLoreNumber({ field, changed }: { field: 'tokenBudget' | 'scanDepth'; changed: boolean }) {
  const store = useStore();
  const { label, help, unit, amount, is } = LORE_SCAN_WORDS[field];
  const save = useAutosave<{ value: number }>(`lore-${field}`, (patch) => setSharedLoreScan(store, field, patch.value!));
  const typed = useTypedNumber(readCount, save.unsaved.value ?? sharedLoreScan(store)[field], { error: '1 이상의 정수를 입력해 주세요.', onChange: (value) => save.change({ value }) });
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
