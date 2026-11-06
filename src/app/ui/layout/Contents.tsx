import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Contents.module.css';

type Item = { id: string; title: string };

// A page's sections as links to their anchors (Section anchor), the one in view marked: a Screen's aside, open beside
// the body, folded above it on a narrow screen.
export function Contents({ label, items }: { label: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const current = useInView(items);
  const id = useId();
  return (
    <nav className={styles.contents} aria-label={label}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {label}
        <span className={styles.chevron}>
          <Icon icon={ChevronDown} size="sm" />
        </span>
      </button>
      <span className={styles.label}>{label}</span>
      <ol id={id} className={open ? `${styles.list} ${styles.open}` : styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <a className={styles.link} href={`#${item.id}`} aria-current={item.id === current ? 'location' : undefined} onClick={() => setOpen(false)}>
              {item.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// The last section whose head has passed the top quarter of the window, or the last one once the page ends.
function useInView(items: Item[]) {
  const [current, setCurrent] = useState(items[0]?.id);
  const ids = items.map((item) => item.id).join(' ');
  useEffect(() => {
    const heads = ids.split(' ').flatMap((id) => document.getElementById(id) ?? []);
    const pick = () => {
      const ended = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;
      const passed = heads.filter((head) => head.getBoundingClientRect().top <= window.innerHeight / 4);
      setCurrent((ended ? heads.at(-1) : passed.at(-1) ?? heads[0])?.id);
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    return () => window.removeEventListener('scroll', pick);
  }, [ids]);
  return current;
}
