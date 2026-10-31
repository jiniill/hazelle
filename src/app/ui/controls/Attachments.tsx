import { FileText, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Icon } from '../foundation/Icon';
import { PictureView } from '../overlays/PictureView';
import styles from './Attachments.module.css';

// Saving/failed pictures cannot send; text attachments are ready immediately. label names both remove action and alt text.
export type Attached = { key: string; label: string; state: 'saving' | 'saved' | 'failed' } & ({ kind: 'picture'; url: string } | { kind: 'file'; detail: string });

// opens: a picture pressed shows large. No onRemove: what is attached stays.
export function Attachments({ items, onRemove, opens = false }: { items: readonly Attached[]; onRemove?: (key: string) => void; opens?: boolean }) {
  const [open, setOpen] = useState<{ url: string; label: string; ratio: number } | null>(null);
  if (!items.length) return null;
  return (
    <>
    <ul className={styles.list} aria-label="첨부">
      {items.map((item) => (
        <li key={item.key} className={`${item.kind === 'file' ? styles.file : styles.item} ${item.state === 'failed' ? styles.failed : ''}`}>
          {item.kind === 'picture' ? (
            opens ? (
              <button
                type="button"
                className={styles.open}
                aria-label={`${item.label} 크게 보기`}
                onClick={({ currentTarget }) => {
                  const { naturalWidth, naturalHeight } = currentTarget.firstElementChild as HTMLImageElement;
                  setOpen({ url: item.url, label: item.label, ratio: naturalWidth / naturalHeight });
                }}
              >
                <img className={styles.picture} src={item.url} alt={item.label} />
              </button>
            ) : (
              <img className={styles.picture} src={item.url} alt={item.label} />
            )
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
          {onRemove && (
            <button type="button" className={styles.remove} aria-label={`${item.label} 빼기`} title="빼기" onClick={() => onRemove(item.key)}>
              <Icon icon={X} size="sm" />
            </button>
          )}
        </li>
      ))}
    </ul>
    {open && <PictureView src={open.url} label={open.label} ratio={open.ratio} onClose={() => setOpen(null)} />}
    </>
  );
}
