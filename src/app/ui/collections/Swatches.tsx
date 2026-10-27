import { Check } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { faceStyle } from '../foundation/fonts';
import { Icon } from '../foundation/Icon';
import { schemeAttributes, type Scheme } from '../foundation/theme';
import type { Reading } from '../layout/ChatFrame';
import { MoreMenu } from '../overlays/MoreMenu';
import { useDragOrder } from './dragOrder';
import styles from './Swatches.module.css';

// menu: MenuItems for the look, under a ⋯ by its name.
export type Swatch = Scheme & { name: string; font: Reading['font']; size: number; pressed: boolean; onPick: () => void; menu?: ReactNode };

// Render each swatch in its own scheme/font, independent of app appearance. onMove uses the final card index.
export function Swatches({ label, sample, items, onMove }: { label: string; sample: string; items: Swatch[]; onMove?: (from: number, to: number) => void }) {
  const order = useDragOrder(onMove ?? (() => {}), 'x');
  return (
    <div className={styles.swatches} role="group" aria-label={label} onDragOver={order.allow} onDrop={order.drop}>
      {items.map(({ name, theme, bg, ink, accent, dialogue, font, size, pressed, onPick, menu }, index) => (
        <div
          key={index}
          className={[styles.card, order.from === index && styles.dragged, order.at === index && styles.before, index === items.length - 1 && order.at === items.length && styles.after].filter(Boolean).join(' ')}
          onDragOver={(event) => order.over(event, index)}
        >
          <button type="button" className={styles.pick} aria-pressed={pressed} onClick={onPick} draggable={onMove !== undefined} onDragStart={(event) => order.start(event, index, name)} onDragEnd={order.end}>
            <span className={styles.sample} {...schemeAttributes({ theme, bg, ink, accent, dialogue })} style={{ ...faceStyle(font), '--swatch-size': `${size}px` } as CSSProperties} aria-hidden>
              {sample}
            </span>
            <span className={styles.meta}>
              <span className={styles.name}>
                {name}
                {pressed && <Icon icon={Check} size="sm" />}
              </span>
            </span>
          </button>
          {menu && (
            <span className={styles.menu}>
              <MoreMenu of={name}>
                {menu}
              </MoreMenu>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
