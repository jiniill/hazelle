import { FileText, TriangleAlert, X } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './Attachments.module.css';

// saving: a picture's file is still being saved; failed: it was not, and goes with nothing until removed. A text file
// is whole as soon as it is put there. label: what its remove button and a picture's alt name it by.
export type Attached = { key: string; label: string; state: 'saving' | 'saved' | 'failed' } & ({ kind: 'picture'; url: string } | { kind: 'file'; detail: string });

// What a message about to be sent carries, above the composer's text.
export function Attachments({ items, onRemove }: { items: readonly Attached[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className={styles.list} aria-label="첨부">
      {items.map((item) => (
        <li key={item.key} className={`${item.kind === 'file' ? styles.file : styles.item} ${item.state === 'failed' ? styles.failed : ''}`}>
          {item.kind === 'picture' ? (
            <img className={styles.picture} src={item.url} alt={item.label} />
          ) : (
            <>
              <Icon icon={FileText} size="sm" />
              <span className={styles.words}>
                <span className={styles.name}>{item.label}</span>
                <span className={styles.detail}>{item.detail}</span>
              </span>
            </>
          )}
          {item.state === 'saving' && (
            <span className={styles.cover} role="status" aria-label="올리는 중">
              <span className={styles.spinner} />
            </span>
          )}
          {item.state === 'failed' && (
            <span className={`${styles.cover} ${styles.mark}`} role="status" aria-label="올리지 못했어요">
              <Icon icon={TriangleAlert} size="sm" />
            </span>
          )}
          <button type="button" className={styles.remove} aria-label={`${item.label} 빼기`} title="빼기" onClick={() => onRemove(item.key)}>
            <Icon icon={X} size="sm" />
          </button>
        </li>
      ))}
    </ul>
  );
}
