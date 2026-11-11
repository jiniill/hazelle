import { Activity, AtSign, Backpack, CalendarDays, Contact, ListChecks, MapPin, MessageCircle, NotebookPen, Wallet, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import type { Theme } from '../foundation/theme';
import type { StatusApp } from './shown';
import { moodScheme } from './StatusPanel';
import styles from './StatusPhone.module.css';

const ICONS: Record<StatusApp, LucideIcon> = { messages: MessageCircle, contacts: Contact, feed: AtSign, notes: NotebookPen, calendar: CalendarDays, map: MapPin, bag: Backpack, tasks: ListChecks, money: Wallet, stats: Activity };

// fresh: how many rows the latest reply added to what the app shows.
type App = { id: string; name: string; icon: StatusApp; fresh: number };
type Props = { name: string; theme: Theme; apps: App[]; onOpen: (id: string) => void; onHome?: () => void; children?: ReactNode };

// 휴대폰 (design §6.1 part 4): a phone whose apps are views. Its home lists the apps; children is the screen of the one
// open (a bare StatusPanel), standing in the home's place. onHome: the bar under the screen goes back to the home;
// without it the home is what is shown.
export function StatusPhone({ name, theme, apps, onOpen, onHome, children }: Props) {
  return (
    <section className={styles.phone} aria-label={name} data-mood="hazelle" {...moodScheme('hazelle', theme)}>
      <div className={styles.screen}>
        {children ?? (
          <ul className={styles.home}>
            {apps.map((app) => (
              <li key={app.id}>
                <button type="button" className={styles.app} onClick={() => onOpen(app.id)}>
                  <span className={styles.tile}>
                    <Icon icon={ICONS[app.icon]} />
                    {app.fresh > 0 && (
                      <span className={styles.count} aria-label={`새 소식 ${app.fresh}개`}>
                        {app.fresh}
                      </span>
                    )}
                  </span>
                  <span className={styles.label}>{app.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className={styles.bar} aria-label="홈" disabled={!onHome} onClick={onHome} />
    </section>
  );
}
