import type { ReactNode } from 'react';
import lantern from './art/lantern.webp';
import room from './art/room.webp';
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
    <div className={styles.doorLeaf} />
    <div className={styles.doorFrame}>
      <div className={styles.room}>
        <img className={styles.roomBehind} src={room} alt="" loading="lazy" decoding="async" />
        <div className={styles.roomInside}>{children}</div>
      </div>
      <div className={styles.doorKeystone} />
    </div>
    <div className={styles.doorSill} />
  </div>
);

const Lantern = ({ lit }: { lit: boolean }) => (
  <span className={`${styles.lantern} ${lit ? styles.lanternLit : styles.lanternOut}`}>
    <img src={lantern} alt="" width="216" height="436" loading="lazy" decoding="async" />
  </span>
);

export const TrialSteps = ({ steps, at }: { steps: readonly string[]; at: number }) => (
  <ol className={styles.steps}>
    {steps.map((step, index) => (
      <li key={step} className={index === at ? styles.stepNow : index < at ? styles.stepDone : styles.step} aria-current={index === at ? 'step' : undefined}>
        <Lantern lit={index <= at} />
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

// Hanging from the dark above, each on its own length of rope, its tag tied below; the whole lantern is the link.
export const KeyPlaces = ({ places }: { places: readonly { name: string; site: string; href: string; action: string }[] }) => (
  <ul className={styles.places}>
    {places.map(({ name, site, href, action }) => (
      <li key={name} className={styles.place}>
        <a className={styles.placeLink} href={href} target="_blank" rel="noreferrer">
          <span className={styles.lanternBody}>
            <Lantern lit />
          </span>
          <span className={styles.placeTag}>
            <span className={styles.placeName}>{name}</span>
            <span className={styles.placeSite}>{site}</span>
            <span className={styles.placeAction}>{action}</span>
          </span>
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
