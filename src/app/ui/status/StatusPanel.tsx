import { ChevronDown, ChevronUp } from 'lucide-react';
import { useContext, useState, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { classNames } from '../foundation/classNames';
import { schemeAttributes, type Mode } from '../foundation/scheme';
import { StatusEditContext, StatusFrameContext, StatusOpenContext } from './frame';
import type { ShownBlock, ShownField, ShownPlace, StatusEdit, StatusFrame, StatusMood } from './shown';
import { StatusField } from './StatusField';
import { StatusChat } from './StatusChat';
import { StatusFeed, StatusLog } from './StatusLog';
import styles from './StatusPanel.module.css';
import { StatusPress } from './StatusPress';
import { StatusRadar } from './StatusRadar';
import { StatusRecords } from './StatusRecords';

type Act = { onChoice?: (text: string) => void };
type Tab = { id: string; name: string; blocks: ShownBlock[] };

// A line holds values only: what needs a box of its own (a 기록, choices) is left to the views that have the room.
function Inline({ blocks }: { blocks: ShownBlock[] }) {
  return blocks.map((block) => {
    switch (block.block) {
      case 'field':
        return <StatusField key={block.field.id} field={block.field} />;
      case 'head':
        return block.items.map((item) => <StatusField key={item.id} field={{ ...item, kind: 'text' }} />);
      case 'radar':
        return block.axes.map((axis) => <StatusField key={axis.id} field={{ id: axis.id, name: axis.name, kind: 'number', value: axis.value }} />);
      case 'records':
        return <StatusField key={block.id} fixed field={{ id: block.id, name: block.name, kind: 'number', value: `${block.members.length}` }} />;
      case 'section':
        return <Inline key={block.id} blocks={block.blocks} />;
      case 'tabs':
        return block.tabs[0] && <Inline key={block.id} blocks={block.tabs[0].blocks} />;
      case 'log':
      case 'feed':
      case 'chat':
      case 'choices':
        return null;
    }
  });
}

function Tabs({ tabs, onChoice }: { tabs: Tab[] } & Act) {
  const [picked, setPicked] = useState(tabs[0]?.id);
  const open = tabs.find(({ id }) => id === picked) ?? tabs[0];
  if (!open) return null;
  return (
    <div className={styles.tabbed}>
      <div className={styles.tabs}>
        {tabs.map(({ id, name }) => (
          <button key={id} type="button" className={styles.tab} aria-pressed={id === open.id} onClick={() => setPicked(id)}>
            {name}
          </button>
        ))}
      </div>
      <div className={styles.blocks}>
        <Blocks blocks={open.blocks} onChoice={onChoice} />
      </div>
    </div>
  );
}

function Blocks({ blocks, onChoice }: { blocks: ShownBlock[] } & Act) {
  const frame = useContext(StatusFrameContext);
  return blocks.map((block) => {
    switch (block.block) {
      case 'field': {
        const { field } = block;
        // A HUD sets its gauges and its numbers two to a line.
        const half = frame === 'hud' && !field.main && (field.kind === 'gauge' || field.kind === 'number');
        return half ? (
          <div key={field.id} className={styles.half}>
            <StatusField field={field} />
          </div>
        ) : (
          <StatusField key={field.id} field={field} />
        );
      }
      case 'head':
        return (
          <header key={block.id} className={styles.head}>
            {block.items.map(({ id, name, value }) => (
              <span key={id} title={name}>
                {value}
                <StatusPress id={id} name={name} />
              </span>
            ))}
          </header>
        );
      case 'radar':
        return <StatusRadar key={block.id} axes={block.axes} />;
      case 'records':
        return <StatusRecords key={block.id} id={block.id} name={block.name} look={block.look} columns={block.columns} members={block.members} />;
      case 'log':
        return <StatusLog key={block.id} name={block.name} columns={block.columns} rows={block.rows} />;
      case 'feed':
        return <StatusFeed key={block.id} name={block.name} posts={block.posts} />;
      case 'chat':
        return <StatusChat key={block.id} name={block.name} threads={block.threads} onReply={onChoice} />;
      case 'choices':
        return (
          <section key={block.id} className={styles.choices} aria-label={block.name}>
            <h4 className={styles.title}>{block.name}</h4>
            {block.items.map((item, index) => (
              <button key={index} type="button" className={styles.choice} disabled={!onChoice} onClick={() => onChoice?.(item)}>
                {item}
              </button>
            ))}
          </section>
        );
      case 'section':
        return (
          <section key={block.id} className={styles.section} aria-label={block.name}>
            <h4 className={styles.title}>{block.name}</h4>
            <div className={styles.blocks}>
              <Blocks blocks={block.blocks} onChoice={onChoice} />
            </div>
          </section>
        );
      case 'tabs':
        return <Tabs key={block.id} tabs={block.tabs} onChoice={onChoice} />;
    }
  });
}

// A panel that folds: its title, a note beside it (warn: what went wrong with the latest reply's state), the caller's
// buttons, and the fold. Folded, summary stands in the view's place: a few fields on one line.
type Head = { title: string; note?: { text: string; warn?: boolean }; actions?: ReactNode; open: boolean; onOpen: (open: boolean) => void; labels: { open: string; close: string }; summary: ShownField[] };
type Props = { name: string; frame: StatusFrame; mood: StatusMood; mode: Mode; blocks: ShownBlock[]; head?: Head; bare?: boolean; edit?: StatusEdit; onMember?: (member: NonNullable<ShownPlace['member']>) => void; children?: ReactNode } & Act;

// The mode a fixed 분위기 stands in, so the kit's own controls inside the panel read on its ground.
const MOOD_MODE: Partial<Record<StatusMood, Mode>> = { paper: 'light', rose: 'light', neon: 'dark', forest: 'dark', terminal: 'dark' };

// What a 분위기 pins on the element that wears it: mode is the reader's, which 헤이젤 keeps with the colour picks set
// back to its own; 내 색 takes the page's as they are.
export const moodScheme = (mood: StatusMood, mode: Mode) => (mood === 'own' ? {} : schemeAttributes({ mode: MOOD_MODE[mood] ?? mode, bg: 'base', ink: 'base', accent: 'base', dialogue: 'base' }));

// A 상태 view drawn: its 분위기 gives the colours, face and corners, its 틀 lays the blocks out, and each block draws
// the values it was handed. onChoice: a choice pressed, or a conversation answered; without it they stand disabled.
// edit: a value pressed is handed over to be edited by hand; without it values are only shown. onMember: a record's
// name pressed opens that record. bare: it fills a screen that frames it (a 휴대폰's) and has no edge of its own.
// children: what stands under the blocks, on the panel's ground.
export function StatusPanel({ name, frame, mood, mode, blocks, head, bare, edit, onMember, onChoice, children }: Props) {
  const open = head?.open ?? true;
  return (
    <section className={classNames(styles.panel, frame !== 'card' && open && styles[frame], head && styles.headed, !open && styles.folded, bare && styles.bare)} aria-label={name} data-mood={mood} {...moodScheme(mood, mode)}>
      {head && (
        <div className={styles.bar}>
          {open ? (
            <h3 className={styles.name}>{head.title}</h3>
          ) : (
            <StatusFrameContext.Provider value="line">
              <div className={styles.summary}>{head.summary.length ? head.summary.map((field) => <StatusField key={field.id} field={field} />) : <span className={styles.name}>{head.title}</span>}</div>
            </StatusFrameContext.Provider>
          )}
          {head.note && <span className={head.note.warn ? styles.warn : styles.note}>{head.note.text}</span>}
          <div className={styles.acts}>
            {open && head.actions}
            <IconButton icon={open ? ChevronUp : ChevronDown} size="sm" label={open ? head.labels.close : head.labels.open} expanded={open} onClick={() => head.onOpen(!open)} />
          </div>
        </div>
      )}
      {open && (
        <StatusFrameContext.Provider value={frame}>
          <StatusEditContext.Provider value={edit}>
            <StatusOpenContext.Provider value={onMember}>
              <div className={classNames(styles.blocks, head && styles.held)}>{frame === 'line' ? <Inline blocks={blocks} /> : <Blocks blocks={blocks} onChoice={onChoice} />}</div>
            </StatusOpenContext.Provider>
          </StatusEditContext.Provider>
        </StatusFrameContext.Provider>
      )}
      {children}
    </section>
  );
}
