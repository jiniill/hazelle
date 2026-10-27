import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { VeilContext } from '../foundation/veil';
import { readingScope, type Reading } from '../layout/ChatFrame';
import styles from './LogExport.module.css';
import { useMath } from './math';
import { pageLook, staticHtml, type Snapshot } from './snapshot';
import { Story } from './Story';
import { Speech } from './StoryMessage';

// stories: what the message draws, in order: its boxes and its text, each as the chat draws it.
export type LogRow = { key: string; name: string; mine: boolean; stories: string[] };

type Props = { title: string; sub: string | null; css: string; reading: Reading; rows: LogRow[]; onDrawn: (snapshot: Snapshot) => void };

// Lay out offscreen, never display:none, so snapshot has computed styles/decoded pictures.
// Use reading width with no controls and all pictures expanded.
export function LogExport(props: Props) {
  // Drawn once KaTeX has loaded, if any formula needs it: the snapshot is taken as the log is first drawn.
  const math = useMath(props.rows.flatMap(({ stories }) => stories).join(''));
  return math ? <Drawn {...props} /> : null;
}

function Drawn({ title, sub, css, reading, rows, onDrawn }: Props) {
  const article = useRef<HTMLElement>(null);
  const references = useRef<HTMLDivElement>(null);
  const drawn = useRef(onDrawn);
  const scope = readingScope(reading);

  useEffect(() => {
    let live = true;
    const root = article.current!;
    const pictures = [...root.querySelectorAll('*')].flatMap((element) => (element.shadowRoot ? [...element.shadowRoot.querySelectorAll('img')] : []));
    // A picture that does not decode is drawn as the browser draws a broken one.
    void Promise.all(pictures.map((picture) => picture.decode().catch(() => {}))).then(() => {
      if (live) drawn.current(staticHtml(root, pageLook(references.current!)));
    });
    return () => {
      live = false;
    };
  }, []);

  // No veil: whether pictures come is the caller's, which leaves their sources out.
  return createPortal(
    <VeilContext.Provider value={null}>
      <div className={styles.stage} aria-hidden>
        <div ref={references} />
        <article ref={article} className={`${styles.log} ${scope.className}`} style={scope.style}>
          <header className={styles.heading}>
            <h1 className={styles.title}>{title}</h1>
            {sub && <p className={styles.sub}>{sub}</p>}
          </header>
          {rows.map(({ key, name, mine, stories }) => {
            return (
              <section key={key} className={styles.message}>
                <Speech name={name} mine={mine}>
                  {stories.map((html, index) => <Story key={index} html={html} css={css} whole />)}
                </Speech>
              </section>
            );
          })}
        </article>
      </div>
    </VeilContext.Provider>,
    document.body,
  );
}
