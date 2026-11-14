import { Plus, type LucideIcon } from 'lucide-react';
import { createContext, useId, type KeyboardEvent, type MouseEventHandler, type ReactNode, type RefObject } from 'react';
import { classNames } from '../foundation/classNames';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import { useShape, type Shapes } from '../foundation/theme';
import { MoreMenu } from '../overlays/MoreMenu';
import styles from './Composer.module.css';
import { pasteFiles } from './pasteFiles';
import { useAutosize } from './useAutosize';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  // tools: the tools that stand by the field. more: the menu of them all (ComposerTools).
  tools: ReactNode;
  more: ReactNode;
  actions: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  // compact: folded, whatever has the focus; onOpen: a press, a focus or a key in it asks it open.
  compact: boolean;
  onOpen: () => void;
  readOnly?: boolean;
  enterKeyHint?: 'send' | 'enter';
  // attachments: what the message carries, above its text (Attachments). onFiles: files pasted with no text.
  attachments?: ReactNode;
  onFiles?: (files: File[]) => void;
  // What stands at the end of the tools' line where the shape has that end (useAside), such as the chat's model.
  aside?: ReactNode;
};

// Read by SendButton, which gives the focus back to it.
export const ComposerField = createContext<RefObject<HTMLTextAreaElement | null>>({ current: null });

// press: a press on the box's own edge, for a shape whose box is not the composer itself.
type Parts = Record<'label' | 'attachments' | 'input' | 'tools' | 'more' | 'actions' | 'aside', ReactNode> & { press: MouseEventHandler<HTMLDivElement> };

// box: the field over a line of its tools, the menu of them at that line's end before the send button; folded, the
// line goes and the box is the text alone. bar: one line, the menu first, then the field and the send button; the
// tools are behind the menu, and what must stand all the same (useToolRow) goes under the line. Folded, a bar keeps
// its buttons: only a long text draws back to its first line. toolbar: the tools on a line of their own over the
// field, a rule under them, and under the field the menu at the start and the send button at the end; folded, both
// lines go, the rule with the tools. tray: the box is the field and the send button on one line, and under the box,
// on the ground, the menu, the tools and at the line's end the aside; folded, that line goes.
// toolRow: the tools stand in a row by the field. aside: it stands the aside. sign, place: the menu's button and
// the side it opens to.
type Shape = { rows: number; root: string; toolRow: boolean; aside?: true; sign?: LucideIcon; place: 'above-end' | 'above-start'; lay: (parts: Parts) => ReactNode };

const SHAPES: Record<Shapes['composer'], Shape> = {
  box: {
    rows: 2,
    root: styles.box,
    toolRow: true,
    place: 'above-end',
    lay: ({ label, attachments, input, tools, more, actions }) => (
      <>
        {label}
        {attachments}
        {input}
        <div className={styles.fold}>
          <div className={styles.tools}>
            <div className={styles.foot}>
              <div className={styles.toolRow}>{tools}</div>
              <div className={styles.actions}>
                {more}
                {actions}
              </div>
            </div>
          </div>
        </div>
      </>
    ),
  },
  bar: {
    rows: 1,
    root: styles.bar,
    toolRow: false,
    sign: Plus,
    place: 'above-start',
    lay: ({ label, attachments, input, tools, more, actions }) => (
      <>
        {attachments}
        <div className={styles.line}>
          <span className={styles.more}>{more}</span>
          {label}
          {input}
          <div className={styles.actions}>{actions}</div>
        </div>
        <div className={styles.toolRow}>{tools}</div>
      </>
    ),
  },
  toolbar: {
    rows: 1,
    root: styles.toolbar,
    toolRow: true,
    sign: Plus,
    place: 'above-start',
    lay: ({ label, attachments, input, tools, more, actions }) => (
      <>
        <div className={styles.fold}>
          <div className={styles.tools}>
            <div className={styles.head}>
              <div className={styles.toolRow}>{tools}</div>
            </div>
          </div>
        </div>
        {label}
        {attachments}
        {input}
        <div className={styles.fold}>
          <div className={styles.tools}>
            <div className={styles.foot}>
              <span className={styles.more}>{more}</span>
              <div className={styles.actions}>{actions}</div>
            </div>
          </div>
        </div>
      </>
    ),
  },
  tray: {
    rows: 1,
    root: styles.tray,
    toolRow: true,
    aside: true,
    sign: Plus,
    place: 'above-start',
    lay: ({ label, attachments, input, tools, more, actions, aside, press }) => (
      <>
        <div className={styles.well} onMouseDown={press}>
          {attachments}
          <div className={styles.line}>
            {label}
            {input}
            <div className={styles.actions}>{actions}</div>
          </div>
        </div>
        <div className={styles.fold}>
          <div className={styles.tools}>
            <div className={styles.foot}>
              <span className={styles.more}>{more}</span>
              <div className={styles.toolRow}>{tools}</div>
              <div className={styles.aside}>{aside}</div>
            </div>
          </div>
        </div>
      </>
    ),
  },
};

export function Composer({ value, onChange, onKeyDown, placeholder, tools, more, actions, inputRef, compact, onOpen, readOnly, enterKeyHint, attachments, onFiles, aside }: Props) {
  const id = useId();
  const shape = useShape('composer');
  const { rows, root, lay } = SHAPES[shape];
  // Each shape mounts a textarea of its own, which has no height measured yet.
  useAutosize(inputRef, value, shape);
  // A press on the box's own edge, around the text, is a press on the text. Folded while it is written in, a press
  // anywhere opens it with the caret where it was, which a press on the one line shown would move.
  const press: MouseEventHandler<HTMLDivElement> = (event) => {
    const input = inputRef.current!;
    if (event.target !== event.currentTarget && !(compact && document.activeElement === input)) return;
    event.preventDefault();
    input.focus();
    onOpen();
  };
  return (
    <div className={classNames(styles.composer, root, compact && styles.compact)} onMouseDown={press} onFocus={onOpen}>
      <ComposerField.Provider value={inputRef}>
        {lay({
          label: (
            <label className={styles.label} htmlFor={id}>
              메시지
            </label>
          ),
          attachments,
          input: (
            <div className={styles.field}>
              <textarea
                id={id}
                ref={inputRef}
                className={styles.input}
                rows={rows}
                {...NO_AUTOFILL}
                value={value}
                readOnly={readOnly}
                enterKeyHint={enterKeyHint}
                placeholder={placeholder}
                onChange={(event) => {
                  onChange(event.target.value);
                  onOpen();
                }}
                onKeyDown={onKeyDown}
                onPaste={onFiles && ((event) => pasteFiles(event.nativeEvent, onFiles))}
              />
              <span className={styles.peek} aria-hidden>
                {value}
              </span>
            </div>
          ),
          tools,
          more,
          actions,
          aside,
          press,
        })}
      </ComposerField.Provider>
    </div>
  );
}

// Whether the composer stands its tools in a row by the field. Where it does not, only what cannot wait behind the
// menu is handed to it as tools.
export const useToolRow = () => SHAPES[useShape('composer')].toolRow;

// Whether the composer stands an aside. Where it does, what a screen would stand elsewhere is handed to it there.
export const useAside = () => SHAPES[useShape('composer')].aside === true;

// The menu of the composer's tools: ⋯ at the end of their row, or + before the field where there is no row.
export function ComposerTools({ dot, children }: { dot: boolean; children: ReactNode }) {
  const { sign, place } = SHAPES[useShape('composer')];
  return (
    <MoreMenu of="입력창 도구" kind="dialog" size="form" sign={sign} place={place} dot={dot}>
      {children}
    </MoreMenu>
  );
}
