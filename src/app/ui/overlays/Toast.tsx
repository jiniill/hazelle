import { TriangleAlert, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Avatar } from '../foundation/Avatar';
import { Icon } from '../foundation/Icon';
import { formatKeys, type Chord } from '../foundation/keys';
import styles from './Toast.module.css';

export type ToastAction = { label: string; onClick: () => void; keys?: readonly Chord[] };

type Props = {
  message: string;
  detail?: string;
  tone: 'plain' | 'warn';
  action?: ToastAction;
  // How many times it was said while it was up.
  times?: number;
  // Someone's long words, once opened, stay: onKeep tells that their time must not take them away.
  from?: { name: string; face: string | null };
  onKeep?: () => void;
  // The × that puts it away: on the notice's corner while a pointer is on it, so the notice keeps its size, and in the
  // head of one opened to stay. On a phone the others are slid away (ToastStack).
  onClose?: () => void;
  // How long it stays, in ms: a notice with an action draws it as a shrinking line, which stops while paused.
  life: number;
  paused: boolean;
};

export function Toast({ message, detail, tone, action, times = 1, from, onKeep, onClose, life, paused }: Props) {
  const warn = tone === 'warn';
  const [open, setOpen] = useState(false);
  const close = onClose && <IconButton icon={X} size="sm" label="닫기" onClick={onClose} />;
  const mark = warn && (
    <span className={styles.mark}>
      <Icon icon={TriangleAlert} size="sm" />
    </span>
  );
  const again = times > 1 && <span className={styles.times}>×{times}</span>;
  return (
    <div
      className={[styles.toast, paused && styles.paused, open && styles.kept].filter(Boolean).join(' ')}
      role={warn ? 'alert' : 'status'}
      style={{ '--life': `${life}ms` } as CSSProperties}
    >
      <div className={styles.card}>
        {from && open ? (
          <>
            <div className={styles.row}>
              <Avatar face={from.name} image={from.face} size="sm" />
              <span className={styles.name}>{from.name}</span>
              {mark}
              {again}
              {close}
            </div>
            <div className={styles.whole}>{message}</div>
          </>
        ) : from ? (
          <Said from={from} message={message} lead={[mark, again]} onOpen={() => (setOpen(true), onKeep?.())} />
        ) : (
          <div className={styles.row}>
            {mark}
            <div className={styles.text}>
              <span>{message}</span>
              {again}
              {detail && <div className={styles.detail}>{detail}</div>}
            </div>
            {action && (
              <span className={styles.action}>
                <Button variant="ghost" size="sm" label={action.keys && `${action.label} · ${formatKeys(action.keys)}`} onClick={action.onClick}>
                  {action.label}
                </Button>
              </span>
            )}
          </div>
        )}
        {action && <div className={styles.time} />}
      </div>
      {close && !open && <span className={styles.corner}>{close}</span>}
    </div>
  );
}

// Someone's words on one line, cut where they run past it: 보기 opens the whole.
function Said({ from, message, lead, onOpen }: { from: { name: string; face: string | null }; message: string; lead: ReactNode; onOpen: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  // Measured once, as the notice first is: its words never change under it.
  useLayoutEffect(() => setLong(message.includes('\n') || ref.current!.scrollWidth > ref.current!.clientWidth), [message]);
  return (
    <div className={styles.row}>
      <Avatar face={from.name} image={from.face} size="sm" />
      <span className={styles.line}>
        <span className={styles.name}>{from.name}</span>
        {lead}
        <span ref={ref} className={styles.words}>
          {message}
        </span>
      </span>
      {long && (
        <span className={styles.action}>
          <Button variant="ghost" size="sm" expanded={false} onClick={onOpen}>
            보기
          </Button>
        </span>
      )}
    </div>
  );
}
