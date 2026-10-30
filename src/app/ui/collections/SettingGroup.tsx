import { createContext, useContext, useId, type ReactNode } from 'react';
import { RowSwitch } from '../controls/Switch';
import { Hint, type Help } from '../overlays/Hint';
import { FolderMark } from './FolderMark';
import styles from './SettingGroup.module.css';

// A row in a group is one of its ruled rows; a row outside one stands bare among fields with no inset of its own.
const Grouped = createContext(false);

export function SettingGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      <Grouped value>{children}</Grouped>
    </div>
  );
}

type RowProps = {
  label: string;
  // A folder's row, its mark before the label.
  folder?: boolean;
  // Shown in the label's place; label stays the row's name.
  sentence?: ReactNode;
  changed?: boolean;
  // What the reader who does not know it needs, behind an ⓘ. A label it only restates is left out.
  help?: Help;
  sub?: ReactNode;
  // Text the row's value holds, a line each, cut to the row's width.
  preview?: readonly string[];
  control: ReactNode;
  // A small button after the label, such as a pin.
  action?: ReactNode;
  // Wide controls stay below labels at every width; a beside-column would size to their unwrapped width and crush text.
  wide?: boolean;
  // The row's ⋯: at the end of the words' line at every width, where a narrow row puts the control under them.
  menu?: ReactNode;
  error?: string;
  note?: string;
};

export function SettingRow({ label, folder = false, sentence, changed = false, help, sub, preview, control, action, wide = false, menu, error, note }: RowProps) {
  const id = useId();
  const switchId = useId();
  const grouped = useContext(Grouped);
  const className = [styles.row, grouped ? styles.ruled : styles.panel, wide && styles.wide, folder && styles.opens].filter(Boolean).join(' ');
  return (
    <div className={className} role="group" aria-labelledby={sentence ? undefined : id} aria-label={sentence ? label : undefined}>
      <div className={styles.words}>
        <span className={styles.name}>
          {folder && (
            <span className={styles.folder}>
              <FolderMark />
            </span>
          )}
          {sentence ? (
            <span id={id} className={`${styles.label} ${styles.sentence}`}>
              {changed && <span className={styles.changed} aria-hidden />}
              {sentence}
            </span>
          ) : (
            // Only a Switch takes this id, so another control's label activates nothing. A sentence holds controls of its own, which a label may not.
            <label id={id} className={styles.label} htmlFor={switchId}>
              {changed && <span className={styles.changed} aria-hidden />}
              {label}
            </label>
          )}
          {help && <Hint label={label}>{help}</Hint>}
          {action}
        </span>
        {sub && <span className={styles.facts}>{sub}</span>}
        {preview?.map((line, at) => (
          <span key={at} className={styles.preview}>
            {line}
          </span>
        ))}
      </div>
      <div className={styles.control}>
        <RowSwitch value={sentence ? undefined : switchId}>{control}</RowSwitch>
      </div>
      {menu && <div className={styles.menu}>{menu}</div>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}
