import { useCallback, useEffect, useState } from 'react';
import { resolveAssets } from '../../engine/assets';
import { answered, optionLabel, optionValue, picked, toggled, type Onboarding, type OnboardingQuestion } from '../../engine/import/onboarding';
import type { Chat, Writes } from '../../model/chat';
import { onboardingPage } from '../../runtime/chat-context';
import { runaway } from '../common/failure';
import { useLoad } from '../common/useLoaded';
import { useAssetUrl, useSession } from '../session';
import { Button, Callout, Checkbox, ChoiceGroup, Dialog, Section, Stack, Story, Text, TextField } from '../ui';
import { LOADING } from '../common/words';

type Answers = ReadonlyMap<string, string>;

type Props = {
  chatId: string;
  // The new chat as it will be saved, whose variables hold the answers given before.
  chat: Chat;
  onboarding: Onboarding;
  name: string;
  onDone: (answers: Writes) => void;
  onClose: () => void;
};

// A card's 시작 전 설문 in a new chat, as Risu shows it: its questions, or the creator's own page. Only 완료 keeps what
// was answered; closing it keeps the answers given before.
export function ChatOnboarding({ chatId, chat, onboarding, name, onDone, onClose }: Props) {
  const [answers, setAnswers] = useState<Answers>(() => new Map(chat.variables ?? []));
  const [missing, setMissing] = useState(false);
  const set = useCallback((variable: string, value: string) => setAnswers((current) => new Map(current).set(variable, value)), []);
  const form = onboarding.mode === 'form';
  const finish = () => {
    if (form && onboarding.questions.some((question) => question.required && !answered(question, answers))) return setMissing(true);
    onDone([...answers]);
  };
  return (
    <Dialog
      title={onboarding.title || name}
      onClose={onClose}
      onSubmit={finish}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            건너뛰기
          </Button>
          <Button type="submit">완료</Button>
        </>
      }
    >
      {form ? (
        <Stack gap="section">
          {missing && <Callout tone="warn">필수 질문에 답해 주세요.</Callout>}
          {onboarding.description && <Text variant="prose">{onboarding.description}</Text>}
          {onboarding.questions.map((question) => (
            <Question key={question.id} question={question} answers={answers} onChange={set} />
          ))}
        </Stack>
      ) : (
        <Page chatId={chatId} chat={chat} html={onboarding.html} answers={answers} onChange={set} />
      )}
    </Dialog>
  );
}

function Question({ question, answers, onChange }: { question: OnboardingQuestion; answers: Answers; onChange: (variable: string, value: string) => void }) {
  const { title, description, type, varName, required, placeholder, options } = question;
  const label = title || varName;
  const answer = answers.get(varName);
  const control =
    type === 'text' ? (
      <TextField label={label} showLabel={false} placeholder={placeholder || undefined} value={answer ?? ''} onChange={(value) => onChange(varName, value)} />
    ) : type === 'multiple' ? (
      <Stack gap="related">
        {options.map((option, index) => (
          <Checkbox key={index} label={optionLabel(option)} checked={picked(answer).includes(optionValue(option))} onChange={() => onChange(varName, toggled(answer, optionValue(option)))} />
        ))}
      </Stack>
    ) : (
      // By place: two options may give one value.
      <ChoiceGroup
        layout="list"
        label={label}
        options={options.map((option, index) => ({ value: String(index), label: optionLabel(option) }))}
        value={answer === undefined ? null : String(options.findIndex((option) => optionValue(option) === answer))}
        onChange={(index) => onChange(varName, optionValue(options[Number(index)]!))}
      />
    );
  return (
    <Section level={3} title={label} tag={required ? { label: '필수' } : undefined}>
      <Stack gap="related">
        {description && <Text variant="prose">{description}</Text>}
        {control}
      </Stack>
    </Section>
  );
}

function Page({ chatId, chat, html, answers, onChange }: { chatId: string; chat: Chat; html: string; answers: Answers; onChange: (variable: string, value: string) => void }) {
  const session = useSession();
  // Read once as the dialog opens: an answer changes the variables it reads, which would draw the page anew under the reader.
  const read = useLoad((signal) => onboardingPage(session, chatId, chat, html, signal), [session, chatId, html], { describe: () => '설문을 표시하지 못했어요.' });
  useEffect(() => () => session.store.evaluation.forget({ asker: 'onboarding', chat: chatId }), [session, chatId]);
  const page = read.data;
  const url = useAssetUrl([page]);
  if (page === undefined) return read.failure ?? <Text variant="note">{LOADING}</Text>;
  if ('kind' in page) return <Callout tone="warn">{runaway('설문을 표시하기 전에')}</Callout>;
  return <Story html={resolveAssets(page.html, url)} css={resolveAssets(page.css, url)} buttons="live" bind={{ values: answers, onChange }} />;
}
