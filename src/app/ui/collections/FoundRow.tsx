import type { ReactNode } from 'react';
import { Item } from './Item';
import styles from './FoundRow.module.css';

// Words with what was looked for in them, from and to its place.
export type Marked = string | { text: string; from: number; to: number };

type Props = {
  face: ReactNode;
  // Where it stands, from the outside in, such as a chat's character and its title.
  path: readonly Marked[];
  snippet: Marked | null;
  note: string;
  onClick: () => void;
};

function Words({ words }: { words: Marked }) {
  if (typeof words === 'string') return words;
  const { text, from, to } = words;
  return (
    <>
      {text.slice(0, from)}
      <mark className={styles.lit}>{text.slice(from, to)}</mark>
      {text.slice(to)}
    </>
  );
}

// A search result that opens where it was found.
export function FoundRow({ face, path, snippet, note, onClick }: Props) {
  return (
    <Item
      density="tall"
      scheme="list"
      leading={face}
      title={path.map((part, index) => (
        <span key={index}>
          {index > 0 && <span className={styles.step}> › </span>}
          <Words words={part} />
        </span>
      ))}
      meta={note}
      preview={snippet === null ? undefined : <Words words={snippet} />}
      onClick={onClick}
    />
  );
}
