import { Check } from 'lucide-react';
import { useContext, type CSSProperties, type ReactNode } from 'react';
import { faceStyle } from '../foundation/fonts';
import { Icon } from '../foundation/Icon';
import { SchemeContext, schemeAttributes, type Scheme } from '../foundation/scheme';
import { ThemeContext, type Theme } from '../foundation/theme';
import type { Reading } from '../layout/ChatFrame';
import { MoreMenu } from '../overlays/MoreMenu';
import { useDragOrder } from './dragOrder';
import styles from './Swatches.module.css';
import { classNames } from '../foundation/classNames';

// menu: MenuItems for the look, under a ⋯ by its name. theme: the one its sample is drawn in, the app's left out.
// picture: the app's own parts laid out as they stand in a frame, drawn small in the card's theme and scheme in place
// of the sample words; it stands outside the pick, which no button may stand in, and the pick reaches over it.
export type Swatch = Scheme & { name: string; font: Reading['font']; size: number; pressed: boolean; onPick: () => void; menu?: ReactNode; theme?: Theme; picture?: ReactNode };

// Render each swatch in its own scheme/font, independent of app appearance. onMove uses the final card index.
export function Swatches({ label, sample, items, onMove }: { label: string; sample: string; items: Swatch[]; onMove?: (from: number, to: number) => void }) {
  const order = useDragOrder(onMove ?? (() => {}), 'x');
  const worn = useContext(ThemeContext);
  const pictured = items.some(({ picture }) => picture !== undefined);
  return (
    <div className={classNames(styles.swatches, pictured && styles.pictured)} role="group" aria-label={label} onDragOver={order.allow} onDrop={order.drop}>
      {items.map(({ name, mode, bg, ink, accent, dialogue, font, size, pressed, onPick, menu, theme = worn, picture }, index) => (
        <div
          key={index}
          className={classNames(styles.card, order.from === index && styles.dragged, order.at === index && styles.before, index === items.length - 1 && order.at === items.length && styles.after)}
          onDragOver={(event) => order.over(event, index)}
        >
          {picture && (
            <div className={styles.picture} {...schemeAttributes({ mode, bg, ink, accent, dialogue }, theme)} inert aria-hidden>
              <ThemeContext value={theme}>
                <SchemeContext value={{ mode, bg, ink, accent, dialogue }}>
                  <div className={styles.small}>{picture}</div>
                </SchemeContext>
              </ThemeContext>
            </div>
          )}
          <button type="button" className={classNames(styles.pick, picture !== undefined && styles.over)} aria-pressed={pressed} onClick={onPick} draggable={onMove !== undefined} onDragStart={(event) => order.start(event, index, name)} onDragEnd={order.end}>
            {!picture && (
              <span className={styles.sample} {...schemeAttributes({ mode, bg, ink, accent, dialogue }, theme)} style={{ ...faceStyle(font), '--swatch-size': `${size}px` } as CSSProperties} aria-hidden>
                {sample}
              </span>
            )}
            <span className={styles.meta}>
              <span className={styles.name}>
                {name}
                {pressed && <Icon icon={Check} size="sm" />}
              </span>
            </span>
          </button>
          {menu && (
            <span className={styles.menu}>
              <MoreMenu of={name} place="end">
                {menu}
              </MoreMenu>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
