import type { CSSProperties } from 'react';
import { classNames } from '../foundation/classNames';
import styles from './SendLine.module.css';

// read: answered from the cache. again: text the last request cached, paid for in full. fresh: new to this request.
// missed: text the request could read from the cache and the provider did not.
export type SendFate = 'read' | 'again' | 'fresh' | 'missed';
type Segment = { size: number; fate: SendFate };

type Props = {
  label: string;
  figure: string;
  unit: string;
  caption: string;
  tone?: 'plain' | 'warn';
  // The request's parts in the order they go out; neighbours of one fate are drawn as one.
  segments: Segment[];
  // The request before it, drawn thin above; moved: a stretch of it, by where it starts in each, that now stands elsewhere.
  was?: { label: string; segments: Segment[]; moved?: { from: number; to: number; size: number } };
  now: string;
  // Where the cache stops answering, counted from the start, and the words for it.
  cut?: { at: number; note: string };
  spans?: { label: string; size: number }[];
  legend: { fate: SendFate; label: string; value: string }[];
};

const merged = (segments: Segment[]) =>
  segments.reduce<Segment[]>((out, each) => {
    const open = out.at(-1);
    if (open?.fate === each.fate) open.size += each.size;
    else if (each.size > 0) out.push({ ...each });
    return out;
  }, []);

const sized = (size: number) => ({ '--size': size }) as CSSProperties;

function Bar({ segments, thin }: { segments: Segment[]; thin?: boolean }) {
  return (
    <span className={classNames(styles.bar, thin && styles.thin)}>
      {merged(segments).map((each, at) => (
        <span key={at} className={classNames(styles.segment, styles[each.fate])} style={sized(each.size)} />
      ))}
    </span>
  );
}

export function SendLine({ label, figure, unit, caption, tone = 'plain', segments, was, now, cut, spans = [], legend }: Props) {
  const total = segments.reduce((sum, { size }) => sum + size, 0) || 1;
  const before = was ? was.segments.reduce((sum, { size }) => sum + size, 0) || 1 : 1;
  const moved = was?.moved;
  const x = (at: number, of: number) => (at / of) * 100;
  return (
    <div className={styles.sendLine}>
      <p className={styles.head}>
        <span className={classNames(styles.figure, tone === 'warn' && styles.warn)}>
          {figure}
          <span className={styles.unit}>{unit}</span>
        </span>
        <span className={styles.caption}>{caption}</span>
      </p>
      <div className={styles.picture} role="img" aria-label={label}>
        {was && (
          <>
            <span className={styles.lane}>{was.label}</span>
            <Bar segments={was.segments} thin />
            <svg className={styles.link} viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden>
              {moved && <polygon points={`${x(moved.from, before)},0 ${x(moved.from + moved.size, before)},0 ${x(moved.to + moved.size, total)},14 ${x(moved.to, total)},14`} />}
            </svg>
          </>
        )}
        <span className={styles.lane}>
          {now}
          {cut && <span className={styles.cutNote}>{cut.note}</span>}
        </span>
        <span className={styles.frame}>
          <Bar segments={segments} />
          {cut && <span className={styles.cut} style={{ '--at': cut.at / total } as CSSProperties} />}
        </span>
        {spans.length > 0 && (
          <span className={styles.spans}>
            {spans.map((span, at) => (
              <span key={at} className={styles.span} style={sized(span.size)}>
                {span.label}
              </span>
            ))}
          </span>
        )}
      </div>
      <dl className={styles.legend}>
        {legend.map((item) => (
          <div key={item.fate} className={styles.key}>
            <span className={classNames(styles.swatch, styles[item.fate])} aria-hidden />
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
