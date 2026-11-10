import { ChevronRight } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import a11y from '../foundation/a11y.module.css';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { FolderMark } from './FolderMark';
import { RowControl, type RowMenu } from './RowControl';
import styles from './Table.module.css';
import { classNames } from '../foundation/classNames';

// track: the column's kind. name: the row's own column, wider than the rest; figure: a count or a size, set right;
// button: a row's ⋯.
// keep: still shown when the table is narrow, where every other column but the first gives way to the row's summary.
export type TableColumn = { label: string; track: 'name' | 'fill' | 'figure' | 'button'; keep?: boolean };

// Null cells mean absent and draw a dash. Narrow layouts show other columns in summary.
// Folder rows accept dragged item keys; selected is absent outside multi-pick mode.
export type TableRow = {
  key: string;
  cells: (ReactNode | null)[];
  summary?: ReactNode;
  // After the row's name, never cut with it.
  badge?: string;
  tags?: string[];
  current?: boolean;
  folder?: boolean;
  selected?: boolean;
  drag?: string;
  onDropCard?: (key: string) => void;
  onClick?: () => void;
  // Beside the row, outside its button: a ⋯, or a fold of the rows under it. A table holding one keeps its room at
  // the end of every row, so the columns stay in line.
  control?: ReactNode;
  menu?: RowMenu;
  // Rows folded under this one, such as its copies: their first cells hang from a guide line.
  under?: TableRow[];
};

const TRACKS = { name: 'minmax(0, 2fr)', fill: 'minmax(0, 1fr)', figure: 'var(--table-figure-width)', button: 'var(--control-md)' };

const holds = (rows: TableRow[]): boolean => rows.some((row) => row.control || (row.under && holds(row.under)));

// compare: each cell cut to its line, read at a glance. read: words read whole, such as a guide's, wrapping; its
// columns all keep, and keep their shares when narrow.
export function Table({ label, columns, rows, variant = 'compare' }: { label: string; columns: TableColumn[]; rows: TableRow[]; variant?: 'compare' | 'read' }) {
  const tracks = {
    '--table-wide': columns.map((column) => TRACKS[column.track]).join(' '),
    '--table-narrow': columns.filter((column, index) => index === 0 || column.keep).map((_, index) => (index === 0 ? 'minmax(0, 1fr)' : 'auto')).join(' '),
  } as CSSProperties;
  const held = holds(rows);
  return (
    <div className={classNames(styles.table, variant === 'read' && styles.read, held && styles.held)} style={tracks}>
      {/* Hidden from the reader: each cell says its own column's name, which a row read as one button would lose. */}
      <div className={`${styles.row} ${styles.head}`} aria-hidden>
        {columns.map((column, index) => (
          <span key={column.label || index} className={cellClass(column, index)}>{column.label}</span>
        ))}
      </div>
      <ul className={styles.rows} aria-label={label}>
        {rows.map((row) => (
          <Line key={row.key} row={row} columns={columns} depth={0} />
        ))}
      </ul>
    </div>
  );
}

const cellClass = (column: TableColumn, index: number) =>
  classNames(column.track === 'button' ? styles.control : styles.cell, column.track === 'figure' && styles.figure, index > 0 && !column.keep && styles.drop);

function Line({ row, columns, depth }: { row: TableRow; columns: TableColumn[]; depth: number }) {
  const { badge, tags = [] } = row;
  const lead = (content: ReactNode) => <span className={styles.lead}>{content}</span>;
  const cells = row.cells.map((content, index) => (
    <span key={index} className={classNames(cellClass(columns[index]!, index), index === 0 && depth > 0 && styles.hung)}>
      {index > 0 && columns[index]!.label && <span className={a11y.srOnly}>{columns[index]!.label} </span>}
      {index === 0 ? (
        <span className={styles.first}>
          {row.folder ? (
            <span className={styles.marked}>
              <FolderMark />
              {lead(content)}
              <Icon icon={ChevronRight} size="sm" />
            </span>
          ) : badge || tags.length > 0 ? (
            <span className={styles.named}>
              {lead(content)}
              {badge && <Tag tone="accent">{badge}</Tag>}
              {tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </span>
          ) : (
            lead(content)
          )}
          {row.summary && <span className={styles.summary}>{row.summary}</span>}
        </span>
      ) : content === null ? (
        <span className={styles.none} aria-label="없음">—</span>
      ) : (
        content
      )}
    </span>
  ));
  return (
    <li>
      <RowControl control={row.control} menu={row.menu} drag={row.drag} onDropCard={row.onDropCard}>
        {row.onClick ? (
          <button type="button" className={classNames(styles.row, styles.open, !row.control && styles.alone)} aria-current={row.current || undefined} aria-pressed={row.selected} onClick={row.onClick}>
            {cells}
          </button>
        ) : (
          <div className={classNames(styles.row, !row.control && styles.alone)}>{cells}</div>
        )}
      </RowControl>
      {row.under && (
        <ul className={styles.under} style={{ '--depth': depth + 1 } as CSSProperties}>
          {row.under.map((each) => (
            <Line key={each.key} row={each} columns={columns} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
