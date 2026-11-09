import { ArrowUp, Square } from 'lucide-react';
import { useContext, type MouseEvent, type RefObject } from 'react';
import { Icon } from '../foundation/Icon';
import { ComposerField } from './Composer';
import styles from './SendButton.module.css';

type Props = { streaming: boolean; disabled: boolean; title: string; onClick: () => void };

export function SendButton({ streaming, disabled, title, onClick }: Props) {
  const field = useContext(ComposerField);
  return (
    <button
      type="button"
      className={streaming ? `${styles.send} ${styles.stop}` : styles.send}
      aria-label={streaming ? '응답 생성 중지' : '보내기'}
      title={title}
      disabled={disabled}
      {...pressKeepsField(field, onClick)}
    >
      <Icon icon={streaming ? Square : ArrowUp} size="sm" />
    </button>
  );
}

// The focus stays in the composer's field, where Esc stops the reply a press started: a pointer's press never takes
// it, so a phone's keyboard stays up, and a key's gives it back.
export function pressKeepsField(field: RefObject<HTMLTextAreaElement | null>, onClick: () => void) {
  return {
    onMouseDown: (event: MouseEvent) => event.preventDefault(),
    onClick: () => {
      onClick();
      field.current?.focus();
    },
  };
}
