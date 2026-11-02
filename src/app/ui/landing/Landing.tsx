import type { ReactNode } from 'react';
import styles from './Landing.module.css';

// top: the doors' row. children: what the hero's words lead to.
export function Hero({ top, title, line, children }: { top: ReactNode; title: string; line: string; children: ReactNode }) {
  return (
    <header className={styles.hero}>
      <div className={styles.top}>{top}</div>
      <div className={styles.heroWords}>
        <h1 className={styles.heroTitle}>{title}</h1>
        <p className={styles.line}>{line}</p>
        <div className={styles.doors}>{children}</div>
      </div>
    </header>
  );
}

// side: which side the words stand on, with what they lead to beside them on a wide screen.
export function Beat({ id, title, line, side = 'start', children }: { id?: string; title: string; line?: string; side?: 'start' | 'end' | 'whole'; children?: ReactNode }) {
  return (
    <section id={id} className={side === 'whole' ? styles.beat : `${styles.beat} ${styles[side]}`}>
      <div className={styles.words}>
        <h2 className={styles.title}>{title}</h2>
        {line && <p className={styles.line}>{line}</p>}
      </div>
      {children && <div className={styles.held}>{children}</div>}
    </section>
  );
}

// The one lit thing on the page: where the live parts stand.
export const Lantern = ({ children }: { children: ReactNode }) => <div className={styles.lantern}>{children}</div>;

export const TrialSteps = ({ steps, at }: { steps: readonly string[]; at: number }) => (
  <ol className={styles.steps}>
    {steps.map((step, index) => (
      <li key={step} className={index === at ? styles.stepNow : index < at ? styles.stepDone : styles.step} aria-current={index === at ? 'step' : undefined}>
        <span className={styles.stepNumber}>{index + 1}</span>
        {step}
      </li>
    ))}
  </ol>
);

export const Said = ({ by, name, children }: { by: 'them' | 'me'; name?: string; children: ReactNode }) => (
  <div className={by === 'me' ? styles.saidMe : styles.saidThem}>
    {name && <span className={styles.saidName}>{name}</span>}
    {children}
  </div>
);

export const SendRow = ({ children }: { children: ReactNode }) => <div className={styles.sendRow}>{children}</div>;

export const SayChoices = ({ choices, onPick }: { choices: readonly string[]; onPick: (choice: string) => void }) => (
  <div className={styles.choices}>
    {choices.map((choice) => (
      <button key={choice} type="button" className={styles.choice} onClick={() => onPick(choice)}>
        {choice}
      </button>
    ))}
  </div>
);

export const KeyPlaces = ({ places }: { places: readonly { name: string; site: string; href: string; action: string }[] }) => (
  <ul className={styles.places}>
    {places.map(({ name, site, href, action }) => (
      <li key={name} className={styles.place}>
        <span className={styles.placeName}>{name}</span>
        <span className={styles.placeSite}>{site}</span>
        <a className={styles.placeLink} href={href} target="_blank" rel="noreferrer">{action}</a>
      </li>
    ))}
  </ul>
);

export const Promises = ({ points }: { points: readonly string[] }) => (
  <ul className={styles.promises}>
    {points.map((point) => <li key={point}>{point}</li>)}
  </ul>
);
