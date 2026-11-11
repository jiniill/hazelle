import { Check } from 'lucide-react';
import { useContext, type ReactNode } from 'react';
import { classNames } from '../foundation/classNames';
import { StatusFrameContext, UNSET } from './frame';
import { shortOf, type ShownField, type StatusDelta } from './shown';
import styles from './StatusField.module.css';
import { StatusMeter } from './StatusMeter';
import { StatusPress } from './StatusPress';

function Delta({ delta }: { delta: StatusDelta | undefined }) {
  return delta ? <span className={delta.down ? styles.down : styles.up}>{delta.text}</span> : null;
}

const Words = ({ value }: { value: string }) => (value === '' ? <span className={styles.unset}>{UNSET}</span> : <>{value}</>);

function Items({ field }: { field: ShownField & { kind: 'list' } }) {
  const frame = useContext(StatusFrameContext);
  if (!field.items.length) return <span className={styles.unset}>{UNSET}</span>;
  if (!field.checked && frame !== 'diary') {
    return (
      <ul className={styles.chips}>
        {field.items.map(({ text }, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={styles.lines}>
      {field.items.map(({ text, done }, index) => (
        <li key={index} className={done ? styles.done : undefined}>
          {field.checked ? <span className={styles.box}>{done && <Check aria-hidden />}</span> : <span className={styles.dot} />}
          <span>{text}</span>
          {done && <span className={styles.heard}>완료</span>}
        </li>
      ))}
    </ul>
  );
}

function Scale({ field }: { field: ShownField & { kind: 'stage' } }) {
  const at = field.labels.indexOf(field.value);
  return (
    <span className={styles.scale}>
      <StatusMeter name={field.name} look="segments" share={(at + 1) / field.labels.length} steps={field.labels.length} tone={field.tone} text={field.value} />
      <span className={styles.labels} aria-hidden>
        {field.labels.map((label, index) => (
          <span key={index} className={index === at ? styles.at : undefined}>
            {label}
          </span>
        ))}
      </span>
    </span>
  );
}

const figureOf = (field: ShownField & { kind: 'gauge' }) => (field.value === '' ? UNSET : `${field.value} / ${field.max}`);

// One field of a 상태 view in its 틀: its name, its value as its kind draws it, and what the latest reply moved it by.
// A 대표 field stands large over its meter, whatever the 틀; in a line's room every kind is a few words. fixed: drawn
// as a field without being one (a count), so never pressed.
export function StatusField({ field, fixed = false }: { field: ShownField; fixed?: boolean }) {
  const frame = useContext(StatusFrameContext);
  const press = fixed ? null : <StatusPress id={field.id} name={field.name} />;
  const gauge = field.kind === 'gauge' ? field : null;
  if (frame === 'line') {
    return (
      <span className={styles.inline}>
        <span className={styles.name}>{field.name}</span>
        {gauge && gauge.value !== '' && <StatusMeter name={field.name} look={gauge.look === 'segments' ? 'segments' : 'bar'} share={gauge.share} zero={gauge.zero} steps={gauge.steps} tone={field.tone} size="sm" text={figureOf(gauge)} />}
        <span className={styles.short}>{field.kind === 'list' ? `${field.items.length}개` : <Words value={shortOf(field)} />}</span>
        <Delta delta={field.delta} />
        {press}
      </span>
    );
  }
  if (field.main && field.kind !== 'list' && !(field.kind === 'text' && field.thought)) {
    return (
      <div className={styles.main}>
        <span className={styles.name}>{field.name}</span>
        <span className={field.kind === 'gauge' || field.kind === 'number' ? styles.figure : styles.headline}>
          <Words value={field.value} />
          {gauge && gauge.value !== '' && <span className={styles.of}> / {gauge.max}</span>}
          <Delta delta={field.delta} />
        </span>
        {gauge && gauge.look !== 'ring' && <StatusMeter name={field.name} look={gauge.look} share={gauge.share} zero={gauge.zero} steps={gauge.steps} tone={field.tone} size="lg" text={figureOf(gauge)} />}
        {field.kind === 'stage' && field.scale && <Scale field={field} />}
        {press}
      </div>
    );
  }
  let value: ReactNode;
  let under: ReactNode = null;
  let kind: string | undefined = styles[field.kind];
  if (gauge) {
    const meter = <StatusMeter name={field.name} look={frame === 'diary' && gauge.look === 'bar' ? 'segments' : gauge.look} share={gauge.share} zero={gauge.zero} steps={gauge.steps} tone={field.tone} size={frame === 'hud' ? 'lg' : 'md'} text={figureOf(gauge)} figure={gauge.value} />;
    // A ring holds its value inside, so only what it is out of stands beside it.
    const ring = gauge.look === 'ring';
    const figure = (
      <span className={styles.amount}>
        {!ring && <Words value={gauge.value} />}
        {gauge.value !== '' && <span className={styles.of}> / {gauge.max}</span>}
      </span>
    );
    const inline = frame === 'card' || ring || gauge.look === 'hearts' || gauge.look === 'stars';
    value = inline ? (
      <>
        {meter}
        {figure}
      </>
    ) : (
      figure
    );
    under = inline ? null : meter;
  } else if (field.kind === 'list') {
    value = frame === 'card' ? <Items field={field} /> : null;
    under = frame === 'card' ? null : <Items field={field} />;
  } else if (field.kind === 'stage') {
    value = field.value === '' ? <Words value="" /> : field.scale ? <span className={styles.amount}>{field.value}</span> : <span className={styles.tag}>{field.value}</span>;
    under = field.scale ? <Scale field={field} /> : null;
  } else if (field.kind === 'text' && field.thought) {
    kind = styles.thought;
    value = null;
    under = (
      <span className={styles.thoughtText}>
        <Words value={field.value} />
      </span>
    );
  } else {
    value = (
      <span className={field.kind === 'number' ? styles.amount : styles.words}>
        <Words value={field.value} />
      </span>
    );
  }
  return (
    <div className={classNames(styles.field, styles[frame], kind, under !== null && styles.stacked)}>
      <div className={styles.row}>
        <span className={styles.name}>{field.name}</span>
        {frame === 'diary' && value !== null && <span className={styles.leader} />}
        {value}
        <Delta delta={field.delta} />
      </div>
      {under}
      {press}
    </div>
  );
}
