import { useId, type ReactNode } from 'react';
import { Item } from '../collections/Item';
import { Menu, MenuItem } from '../overlays/Menu';
import { ChipButton } from './ChipButton';
import styles from './ChoiceGroup.module.css';

// fit uses chips only for a few short choices; long/many choices use a menu to avoid crushed labels.
// mark precedes the label; menu renders a quiet inline chooser.
const STRIP = { options: 4, letters: 14 };

type Props<T extends string> = {
  label: string;
  showLabel?: boolean;
  options: { value: T; label: string; sub?: string; mark?: ReactNode }[];
  value: T | null;
  // fit and menu: the chip's words while value is none of the options.
  empty?: string;
  onChange: (value: T) => void;
  layout?: 'chips' | 'buttons' | 'segmented' | 'list' | 'menu' | 'fit' | 'cards';
};

export function ChoiceGroup<T extends string>({ label, showLabel = false, options, value, empty, onChange, layout = 'chips' }: Props<T>) {
  const id = useId();
  const strip = layout === 'fit' && options.length <= STRIP.options && options.map((option) => option.label).join('').length <= STRIP.letters;
  if (strip) return <ChoiceGroup label={label} showLabel={showLabel} options={options} value={value} onChange={onChange} layout="segmented" />;
  if (layout === 'fit' || layout === 'menu') {
    return (
      <Menu label={label} place="below-end" trigger={(opener) => <ChipButton variant={layout === 'menu' ? 'value' : 'field'} label={options.find((option) => option.value === value)?.label ?? empty ?? value ?? ''} title={label} {...opener} />}>
        {options.map((option) => (
          <MenuItem key={option.value} label={option.label} sub={option.sub} checked={option.value === value} onClick={() => onChange(option.value)} />
        ))}
      </Menu>
    );
  }
  const group = (
    <div className={styles[layout]} role="group" aria-label={showLabel ? undefined : label} aria-labelledby={showLabel ? id : undefined}>
      {options.map((option) =>
        // A chip is the filter pill Tabs draws, so a pick of chips reads as a Tabs filter does.
        layout === 'chips' ? (
          <Item key={option.value} density="chip" scheme="tab" leading={option.mark} title={option.label} pressed={option.value === value} onClick={() => onChange(option.value)} />
        ) : (
          <button key={option.value} type="button" className={layout === 'list' ? `${styles.choice} ${styles.option}` : layout === 'cards' ? `${styles.choice} ${styles.card}` : styles.choice} aria-pressed={option.value === value}
            // A card is named by its label alone; its sub describes it.
            {...(layout === 'cards' && { 'aria-labelledby': `${id}-${option.value}`, 'aria-describedby': option.sub ? `${id}-${option.value}-sub` : undefined })}
            onClick={() => onChange(option.value)}
          >
            {layout === 'cards' ? (
              <>
                {option.mark && <span className={styles.cardMark}>{option.mark}</span>}
                <span id={`${id}-${option.value}`} className={styles.cardLabel}>
                  {option.label}
                </span>
                {option.sub && (
                  <span id={`${id}-${option.value}-sub`} className={styles.sub}>
                    {option.sub}
                  </span>
                )}
              </>
            ) : layout === 'list' ? (
              <>
                <span className={styles.dot} aria-hidden />
                <span className={styles.text}>
                  <span>{option.label}</span>
                  {option.sub && <span className={styles.sub}>{option.sub}</span>}
                </span>
              </>
            ) : (
              <>
                {option.mark}
                {option.label}
              </>
            )}
          </button>
        ),
      )}
    </div>
  );
  if (!showLabel) return group;
  // Chips and cards stand as a field among fields, their label above as TextField's; the other layouts sit in a toolbar row.
  const field = layout === 'chips' || layout === 'cards';
  return (
    <div className={field ? styles.field : styles.labelled}>
      <span id={id} className={field ? styles.fieldLabel : styles.label}>
        {label}
      </span>
      {group}
    </div>
  );
}
