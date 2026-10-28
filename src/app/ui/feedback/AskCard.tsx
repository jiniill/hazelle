import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Avatar } from '../foundation/Avatar';
import { isComposing } from '../foundation/keys';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import { Hint, type Help } from '../overlays/Hint';
import styles from './AskCard.module.css';

export type AskAnswer = { kind: 'line' } | { kind: 'choices'; choices: { label: string; value: string | null; primary?: boolean }[] };

type Props = {
  from: { name: string; face: string | null };
  text?: string;
  help?: Help;
  answer: AskAnswer;
  // null: put away unanswered, which the × does.
  onAnswer: (value: string | null) => void;
};

// It waits there and takes no focus, but for the line it asks to be typed.
export function AskCard({ from, text, help, answer, onAnswer }: Props) {
  return (
    <section className={styles.card} aria-label={`${from.name}의 질문`}>
      <div className={styles.head}>
        <Avatar face={from.name} image={from.face} size="sm" />
        <span className={styles.name}>{from.name}</span>
        <IconButton icon={X} size="sm" label="닫기" onClick={() => onAnswer(null)} />
      </div>
      {text && (
        <div className={styles.asked}>
          <p className={styles.text}>{text}</p>
          {help && <Hint label={text}>{help}</Hint>}
        </div>
      )}
      {answer.kind === 'line' ? (
        <Line onSubmit={onAnswer} />
      ) : (
        <div className={`${styles.answer} ${styles.choices}`}>
          {answer.choices.map(({ label, value, primary }, index) => (
            <Button key={index} variant={primary ? 'primary' : 'secondary'} size="sm" onClick={() => onAnswer(value)}>
              {label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function Line({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className={styles.answer}>
      <input
        className={styles.input}
        type="text"
        {...NO_AUTOFILL}
        autoFocus
        aria-label="답"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || isComposing(event.nativeEvent)) return;
          event.preventDefault();
          onSubmit(draft);
        }}
      />
      <Button variant="primary" size="sm" onClick={() => onSubmit(draft)}>
        답하기
      </Button>
    </div>
  );
}
