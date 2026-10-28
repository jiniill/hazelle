import { ArrowUp, Square } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './SendButton.module.css';

type Props = { streaming: boolean; disabled: boolean; title: string; onClick: () => void };

export function SendButton({ streaming, disabled, title, onClick }: Props) {
  return (
    <button
      type="button"
      className={streaming ? `${styles.send} ${styles.stop}` : styles.send}
      aria-label={streaming ? '응답 생성 중지' : '보내기'}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={streaming ? Square : ArrowUp} size="sm" />
    </button>
  );
}
