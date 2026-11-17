import { Square } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { translateOnTool } from '../../runtime/tasks/translate';
import { useSession } from '../session';
import { useOwnUndo, useToast } from '../toast';
import { IconButton } from '../ui';
import { CountedField } from './CountedFields';
import { describeTranslateFailure } from './failure';
import { FEATURE_ICONS } from './featureIcons';
import { languageLabel } from './languages';
import { withParticle } from './particles';
import { STOP, TRANSLATE_FAILED } from './words';

// What a bot's text is written in for its model.
const INTO = 'English';
const INTO_WORDS = withParticle(languageLabel(INTO), '으로/로');

type Field = { value: string; onChange: (value: string) => void };

// 번역기's translator (runtime/tasks/translate translateOnTool) over a field's text, where it stands. Only a whole
// answer takes the text's place: onChange saves, and a cut one would lose the text's end. field is read again when the
// answer lands, since its text may have changed hands meanwhile (a list's entry moved, the big editor typed in).
export function useFieldTranslation(field: Field) {
  const session = useSession();
  const toast = useToast();
  const undoable = useOwnUndo();
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const latest = useRef(field);
  latest.current = field;
  // 되돌리기 stands only while the field holds the translation: past that, it would write over other text.
  const offered = useRef<{ text: string; withdraw: () => void } | null>(null);
  useEffect(() => {
    if (!offered.current || offered.current.text === field.value) return;
    offered.current.withdraw();
    offered.current = null;
  }, [field.value]);

  async function start() {
    const { value } = field;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    const made = await translateOnTool(session, value, INTO, controller.signal, () => {});
    setRunning(false);
    if (!made.ok) {
      if (made.failure.kind !== 'stopped') toast.error(TRANSLATE_FAILED, { detail: describeTranslateFailure(made.failure) });
      return;
    }
    if (controller.signal.aborted) return;
    if (made.translation.receipt.state === 'cut') return toast.error('번역이 중간에 끊겨서 적용하지 않았어요.');
    if (latest.current.value !== value) return toast.error('번역하는 동안 내용이 바뀌어서 적용하지 않았어요.');
    const { text } = made.translation;
    latest.current.onChange(text);
    offered.current = { text, withdraw: undoable(`${INTO_WORDS} 번역했어요.`, () => latest.current.onChange(value)) };
  }

  return { running, start: () => void start(), stop: () => abort.current?.abort() };
}

// A field of text a model reads, with 영어로 번역 by its label.
export function TranslatableField(props: ComponentProps<typeof CountedField>) {
  const { running, start, stop } = useFieldTranslation(props);
  const button = running ? (
    <IconButton icon={Square} size="sm" label={`${props.label} 번역 ${STOP}`} onClick={stop} />
  ) : (
    <IconButton icon={FEATURE_ICONS.translate} size="sm" label={`${props.label} ${INTO_WORDS} 번역`} disabled={!props.value.trim()} onClick={start} />
  );
  return (
    <CountedField
      {...props}
      readOnly={running}
      hint={running ? `${INTO_WORDS} 번역하는 중…` : props.hint}
      action={
        <>
          {button}
          {props.action}
        </>
      }
    />
  );
}
