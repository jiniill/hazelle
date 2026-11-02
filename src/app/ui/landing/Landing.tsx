import { Fragment, useId, type ReactNode } from 'react';
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

// kind: how the words and what they lead to share the screen, with the walk's scene standing in the room left over.
export function Beat({ id, title, line, kind, foot, children }: { id?: string; title: string; line?: string; kind: 'talk' | 'lanterns' | 'door' | 'points' | 'finish'; foot?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={`${styles.beat} ${styles[kind]}`}>
      <div className={styles.words}>
        <h2 className={styles.title}>{title}</h2>
        {line && <p className={styles.line}>{line}</p>}
      </div>
      <div className={styles.held}>{children}</div>
      {foot && <div className={styles.foot}>{foot}</div>}
    </section>
  );
}

// The cabin's open door: the one warm room on the page, and where the live parts stand.
export const Door = ({ children }: { children: ReactNode }) => (
  <div className={styles.doorway}>
    <div className={styles.room}>{children}</div>
  </div>
);

// named: its glass holds a name, so it has no flame or bars in the way.
function LanternPicture({ lit, named = false }: { lit: boolean; named?: boolean }) {
  const hot = useId();
  return (
    <svg className={styles.lanternPicture} viewBox="0 0 100 150" aria-hidden="true">
      <defs>
        <radialGradient id={hot} cx="50%" cy="56%" r="66%">
          <stop className={styles.glassHot} offset="0" />
          <stop className={styles.glassWarm} offset="0.56" />
          <stop className={styles.glassEdge} offset="1" />
        </radialGradient>
      </defs>
      <path className={styles.iron} d="M50 0a7 7 0 0 1 7 7v7H43V7a7 7 0 0 1 7-7Z" />
      <path className={styles.iron} d="M20 34C24 20 76 20 80 34l6 8H14Z" />
      <rect className={lit ? undefined : styles.glass} fill={lit ? `url(#${hot})` : undefined} x="14" y="42" width="72" height="84" rx="4" />
      {lit && !named && <ellipse className={styles.flame} cx="50" cy="90" rx="8" ry="16" />}
      {!named && <path className={styles.iron} d="M36 42h2v84h-2Zm26 0h2v84h-2Z" />}
      <path className={styles.iron} d="M14 42h72v3H14Zm0 0h3v84h-3Zm69 0h3v84h-3Z" />
      <path className={styles.iron} d="M14 126h72l5 14c1 3-1 5-4 5H13c-3 0-5-2-4-5Z" />
    </svg>
  );
}

export const TrialSteps = ({ steps, at }: { steps: readonly string[]; at: number }) => (
  <ol className={styles.steps}>
    {steps.map((step, index) => (
      <li key={step} className={index === at ? styles.stepNow : index < at ? styles.stepDone : styles.step} aria-current={index === at ? 'step' : undefined}>
        <LanternPicture lit={index <= at} />
        <span>{step}</span>
      </li>
    ))}
  </ol>
);

export const Said = ({ by, name, typing, children }: { by: 'them' | 'me'; name?: string; typing?: boolean; children: ReactNode }) => (
  <div className={by === 'me' ? styles.saidMe : styles.saidThem}>
    {name && <span className={styles.saidName}>{name}</span>}
    {children}
    {typing && <span className={styles.caret} />}
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

// Hanging from the dark above, each on its own length of rope; the whole lantern is the link.
export const KeyPlaces = ({ places }: { places: readonly { name: string; site: string; href: string; action: string }[] }) => (
  <ul className={styles.places}>
    {places.map(({ name, site, href, action }) => (
      <li key={name} className={styles.place}>
        <a className={styles.placeLink} href={href} target="_blank" rel="noreferrer">
          <span className={styles.lanternBody}>
            <LanternPicture lit named />
            <span className={styles.placeName}>{name}</span>
          </span>
          <span className={styles.placeSite}>
            {site.split('.').map((part, index) => (
              <Fragment key={part}>
                {index > 0 && <wbr />}
                {index > 0 && '.'}
                {part}
              </Fragment>
            ))}
          </span>
          <span className={styles.placeAction}>{action}</span>
        </a>
      </li>
    ))}
  </ul>
);

export const Promises = ({ points }: { points: readonly string[] }) => (
  <ul className={styles.promises}>
    {points.map((point) => <li key={point} className={styles.promise}>{point}</li>)}
  </ul>
);
