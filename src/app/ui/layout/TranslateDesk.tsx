import type { KeyboardEvent, ReactNode } from 'react';
import styles from './TranslateDesk.module.css';

type Foot = { note: string; actions: ReactNode };

type Props = {
  tools: ReactNode;
  aside: ReactNode;
  below?: ReactNode;
  source: {
    label: string;
    value: string;
    placeholder: string;
    readOnly: boolean;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    foot: Foot;
  };
  result: { label: string; text: string; placeholder: string; busy: boolean; notice?: ReactNode; foot: Foot };
};

export function TranslateDesk({ tools, aside, below, source, result }: Props) {
  return (
    <div className={styles.desk}>
      <div className={styles.bar}>
        {tools}
        <div className={styles.aside}>{aside}</div>
      </div>
      {below}
      <div className={styles.panes}>
        <div className={styles.pane}>
          <textarea
            className={styles.area}
            autoComplete="off"
            aria-label={source.label}
            value={source.value}
            placeholder={source.placeholder}
            readOnly={source.readOnly}
            onChange={(event) => source.onChange(event.target.value)}
            onKeyDown={source.onKeyDown}
          />
          <FootRow {...source.foot} />
        </div>
        <div className={`${styles.pane} ${styles.result}`}>
          {result.notice && <div className={styles.notice}>{result.notice}</div>}
          <div className={styles.text} role="region" aria-label={result.label} aria-live="polite" aria-busy={result.busy}>
            {result.text || <span className={styles.empty}>{result.placeholder}</span>}
          </div>
          <FootRow {...result.foot} />
        </div>
      </div>
    </div>
  );
}

function FootRow({ note, actions }: Foot) {
  return (
    <div className={styles.foot}>
      <span className={styles.note}>{note}</span>
      {actions}
    </div>
  );
}
