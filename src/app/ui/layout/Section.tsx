import { useLayoutEffect, type ReactNode } from 'react';
import { ButtonSlot } from '../controls/Button';
import { useSeekRow } from '../foundation/seek';
import { Tag } from '../foundation/Tag';
import { Hint, type Help } from '../overlays/Hint';
import styles from './Section.module.css';

type Props = {
  title: string;
  level?: 2 | 3;
  note?: string;
  help?: Help;
  tag?: { label: string; tone?: 'plain' | 'accent' };
  action?: ReactNode;
  seek?: boolean;
  // A Panel's: a group of a page, which may stand beside another (Columns).
  group?: boolean;
  children: ReactNode;
};

export function Section({ title, level = 2, note, help, tag, action, seek = false, group = false, children }: Props) {
  const head = useSeekRow<HTMLDivElement>(title, 'start');
  useLayoutEffect(() => {
    if (seek) head.current?.scrollIntoView({ block: 'start' });
  }, [seek, head]);
  const Heading = level === 2 ? 'h2' : 'h3';
  const noted = note && <span className={styles.note}>{note}</span>;
  return (
    <section className={[styles.section, styles[`level${level}`], group && styles.group].filter(Boolean).join(' ')}>
      <div ref={head} className={styles.head}>
        <span className={styles.name}>
          <Heading className={styles.title}>{title}</Heading>
          {tag && (
            <span className={styles.tag}>
              <Tag tone={tag.tone}>{tag.label}</Tag>
            </span>
          )}
          {help && <Hint label={title}>{help}</Hint>}
        </span>
        {action ? (
          <span className={styles.end}>
            {noted}
            <ButtonSlot value="sm">{action}</ButtonSlot>
          </span>
        ) : (
          noted
        )}
      </div>
      {children}
    </section>
  );
}
