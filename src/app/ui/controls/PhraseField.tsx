import { X } from 'lucide-react';
import { useState } from 'react';
import { Icon } from '../foundation/Icon';
import { isComposing } from '../foundation/keys';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import styles from './PhraseField.module.css';

type Props = { label: string; phrases: string[]; onChange: (phrases: string[]) => void };

// A phrase is kept exactly as typed: a stop phrase's spaces are part of it.
export function PhraseField({ label, phrases, onChange }: Props) {
  const [draft, setDraft] = useState('');
  return (
    <div className={styles.field} role="group" aria-label={label}>
      {phrases.map((phrase) => (
        <span key={phrase} className={styles.chip}>
          <span className={styles.text}>{phrase}</span>
          <button type="button" className={styles.remove} aria-label={`'${phrase}' 빼기`} onClick={() => onChange(phrases.filter((kept) => kept !== phrase))}>
            <Icon icon={X} size="sm" />
          </button>
        </span>
      ))}
      <input
        className={styles.input}
        type="text"
        {...NO_AUTOFILL}
        aria-label={`${label} 추가`}
        placeholder="입력 후 Enter"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || isComposing(event.nativeEvent)) return;
          event.preventDefault();
          if (!draft.trim() || phrases.includes(draft)) return;
          onChange([...phrases, draft]);
          setDraft('');
        }}
      />
    </div>
  );
}
