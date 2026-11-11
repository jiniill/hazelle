import { ChevronLeft, Reply } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../controls/IconButton';
import { classNames } from '../foundation/classNames';
import { Icon } from '../foundation/Icon';
import type { ShownThread } from './shown';
import styles from './StatusChat.module.css';

type Props = { name: string; threads: ShownThread[]; onReply?: (text: string) => void };

// A 기록 of messages as a messenger: its conversations, the one that spoke last first, and one of them opened as
// bubbles, the reader's own on the other side. onReply: answering puts the conversation's words into the composer;
// without it the answer stands disabled.
export function StatusChat({ name, threads, onReply }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const open = threads.find(({ id }) => id === picked);
  if (open) {
    const { reply } = open;
    return (
      <section className={styles.chat} aria-label={open.name}>
        <div className={styles.bar}>
          <IconButton icon={ChevronLeft} size="sm" label={`${name} 목록`} onClick={() => setPicked(null)} />
          <h4 className={styles.with}>{open.name}</h4>
        </div>
        <ol className={styles.messages}>
          {open.messages.map(({ text, mine, from, meta }, index) => (
            <li key={index} className={classNames(styles.message, mine && styles.mine)}>
              {from && <span className={styles.from}>{from}</span>}
              <p className={styles.bubble}>{text}</p>
              {meta.length > 0 && <span className={styles.meta}>{meta.join(' · ')}</span>}
            </li>
          ))}
        </ol>
        {reply !== undefined && (
          <button type="button" className={styles.reply} disabled={!onReply} onClick={() => onReply?.(reply)}>
            <Icon icon={Reply} size="sm" />
            답하기
          </button>
        )}
      </section>
    );
  }
  return (
    <section className={styles.chat} aria-label={name}>
      <h4 className={styles.title}>{name}</h4>
      <ul className={styles.threads}>
        {threads.map(({ id, name: who, fresh, messages }) => (
          <li key={id}>
            <button type="button" className={styles.thread} onClick={() => setPicked(id)}>
              <span className={styles.face} aria-hidden>
                {[...who][0]}
              </span>
              <span className={styles.lines}>
                <span className={styles.who}>{who}</span>
                <span className={styles.last}>{messages.at(-1)?.text}</span>
              </span>
              {fresh > 0 && (
                <span className={styles.count} aria-label={`새 메시지 ${fresh}개`}>
                  {fresh}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
