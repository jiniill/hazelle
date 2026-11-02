import { useEffect, useRef, type FormEventHandler, type ReactNode } from 'react';
import lantern from './art/lantern.webp';
import { useHanging } from './hanging';
import styles from './Landing.module.css';

// top: the doors' row. The lantern and the moving cue below the words say there is more further down, and need no words of their own.
export function Hero({ top, title, line }: { top: ReactNode; title: string; line: string }) {
  return (
    <header className={styles.hero} data-walk-stop="top">
      <div className={styles.top}>{top}</div>
      <div className={styles.heroWords}>
        <h1 className={styles.heroTitle}>{title}</h1>
        <p className={styles.line}>{line}</p>
      </div>
      <div className={styles.onward} aria-hidden="true">
        <div className={styles.onwardLantern}>
          <Lantern lit />
        </div>
        <div className={styles.onwardCue}>
          <svg className={styles.mouse} viewBox="0 0 24 36" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="1.5" y="1.5" width="21" height="33" rx="10.5" />
            <line className={styles.mouseWheel} x1="12" y1="8" x2="12" y2="13" />
          </svg>
          <svg className={styles.drops} viewBox="0 0 20 26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path className={styles.drop} d="M3 3l7 7 7-7" />
            <path className={styles.drop} d="M3 14l7 7 7-7" />
          </svg>
        </div>
      </div>
    </header>
  );
}

// kind: how the words and what they lead to share the screen, with the walk's scene standing in the room left over.
export function Beat({ id, title, line, kind, foot, children }: { id?: string; title: string; line?: string; kind: 'talk' | 'lanterns' | 'points' | 'finish'; foot?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={`${styles.beat} ${styles[kind]}`} data-walk-stop="">
      <div className={styles.words}>
        <h2 className={styles.title}>{title}</h2>
        {line && <p className={styles.line}>{line}</p>}
      </div>
      <div className={styles.held}>{children}</div>
      {foot && <div className={styles.foot}>{foot}</div>}
    </section>
  );
}

// Over the room in the scene: the words and the live parts appear once the visitor has crossed the threshold, and go as they leave.
// talking: a conversation is under way, and on a narrow screen it takes the words' room.
export function Indoors({ id, title, line, inside, talking, onInside, children }: { id: string; title: string; line: string; inside: boolean; talking: boolean; onInside: (inside: boolean) => void; children: ReactNode }) {
  const stay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const crossing = new IntersectionObserver(([entry]) => onInside(entry!.isIntersecting), { rootMargin: '0px 0px -97% 0px' });
    crossing.observe(stay.current!);
    return () => crossing.disconnect();
  }, []);
  return (
    <section id={id} className={`${styles.beat} ${styles.indoors}`} data-walk-stop="top" data-walk-slow="">
      <div ref={stay} className={styles.stay} />
      <div className={styles.seat} data-inside={inside || undefined}>
        <div className={styles.panel} data-talking={talking || undefined}>
          <div className={styles.words}>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.line}>{line}</p>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

export const PanelBody = ({ children }: { children: ReactNode }) => <div className={styles.panelBody}>{children}</div>;

const CLOSE_TO_END = 40;

// A conversation inside the panel's fixed height: it follows the newest words unless the visitor has scrolled back to read.
// Holds the height of the tallest form its content will take, so what grows inside never moves the page under the walk.
export const RoomFor = ({ forms, children }: { forms: ReactNode[]; children: ReactNode }) => (
  <div className={styles.roomFor}>
    {forms.map((form, index) => <div key={index} className={styles.roomForm} aria-hidden="true">{form}</div>)}
    <div>{children}</div>
  </div>
);

export function TalkBox({ onSubmit, foot, children }: { onSubmit: FormEventHandler<HTMLFormElement>; foot: ReactNode; children: ReactNode }) {
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // A scroll is only the visitor's after their own wheel or finger: replies landing and swapping move the log too, and must not let go of it.
  const reading = useRef(false);
  const read = () => {
    reading.current = true;
  };
  useEffect(() => {
    if (!following.current) return;
    reading.current = false;
    log.current!.scrollTop = log.current!.scrollHeight;
  });
  return (
    <form className={styles.talkBox} onSubmit={onSubmit}>
      <div
        ref={log}
        className={styles.talkLog}
        onWheel={read}
        onTouchMove={read}
        onScroll={({ currentTarget: { scrollHeight, scrollTop, clientHeight } }) => {
          if (reading.current) following.current = scrollHeight - scrollTop - clientHeight < CLOSE_TO_END;
        }}
      >
        {children}
      </div>
      <div className={styles.talkFoot}>{foot}</div>
    </form>
  );
}

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
export function KeyPlaces({ places }: { places: readonly { name: string; site: string; href: string; action: string }[] }) {
  const list = useRef<HTMLUListElement>(null);
  useHanging(list, `.${styles.placeLink}`, `.${styles.placeTag}`);
  return (
  <ul ref={list} className={styles.places}>
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
}

export const Promises = ({ points }: { points: readonly string[] }) => (
  <ul className={styles.promises}>
    {points.map((point) => <li key={point} className={styles.promise}>{point}</li>)}
  </ul>
);
