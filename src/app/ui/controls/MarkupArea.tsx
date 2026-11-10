import { useId, useMemo, type ReactNode, type Ref } from 'react';
import type { Chord } from '../foundation/keys';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import { CodeField, type CodeAside } from './CodeField';
import type { CodeLanguage } from './codeLanguage';
import { markup, type Piece } from './markup';
import styles from './MarkupArea.module.css';
import { useBigEdit } from './useBigEdit';
import { tagWeights } from './weights';
import { classNames } from '../foundation/classNames';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // A short measure of the text, by the label and in its big editor.
  count?: string;
  variant?: 'page' | 'field';
  // prompt: headings, rules, <tags> and the language's own tags; tags: image tags colored by their weight.
  kind?: 'prompt' | 'tags';
  language?: CodeLanguage;
  expand?: readonly Chord[];
  aside?: (text: string) => CodeAside;
  // What is done to the text. Given, the text stands in a frame: these in a bar at its head with the big editor's
  // button at their end, the text, then a foot of its count and `foot`.
  tools?: ReactNode;
  foot?: ReactNode;
  ref?: Ref<HTMLTextAreaElement>;
};

const LINE = { body: null, heading: styles.heading, rule: styles.rule } as const;
const MARK = { tag: styles.cbs, separator: styles.cbs, argument: styles.cbs, comment: styles.comment, slot: styles.slot, angle: styles.angle } as const;
const pieceClass = (piece: Piece) => classNames(LINE[piece.line], piece.mark && MARK[piece.mark]) || undefined;

// Steps of about two braces up, and one or two brackets down.
function weightClass(weight: number | null): string | undefined {
  if (weight === null) return styles.weightSyntax;
  if (weight < 0) return styles.weightNegative;
  if (weight < 0.9) return styles.weightDown2;
  if (weight < 1) return styles.weightDown1;
  if (weight === 1) return undefined;
  if (weight < 1.1) return styles.weightUp1;
  return weight < 1.3 ? styles.weightUp2 : styles.weightUp3;
}

type Run = { text: string; className: string | undefined };

// Neighbours of one class are one span: a tag's name, separators and arguments share a color.
function joined(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (last && last.className === run.className) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

function spansOf(kind: Props['kind'], language: CodeLanguage | undefined, text: string): Run[] {
  const runs =
    kind === 'tags'
      ? tagWeights(text).map(({ text: piece, weight }) => ({ text: piece, className: weightClass(weight) }))
      : markup(text, typeof language?.syntax === 'function' ? language.syntax(text) : []).map((piece) => ({ text: piece.text, className: pieceClass(piece) }));
  // A last empty line has no height in the layer until something is on it.
  return joined(text === '' || text.endsWith('\n') ? [...runs, { text: '\u200b', className: undefined }] : runs);
}

// Use native insertText, not state assignment, so browser undo owns the insertion and input reaches onChange.
export function typeInto(area: HTMLTextAreaElement, [start, end]: [number, number], text: string) {
  area.focus();
  area.setSelectionRange(start, end);
  document.execCommand('insertText', false, text);
}

// Selects a stretch of the text and brings it to the middle of the view. The area is as tall as its text, so what
// scrolls is the pane it stands in, or the page: the place is read off the layer, which draws the same text line for
// line. Only that one scroller moves; scrollIntoView would also shift every clipped box around it.
export function revealIn(area: HTMLTextAreaElement, [start, end]: [number, number]) {
  area.focus({ preventScroll: true });
  area.setSelectionRange(start, end);
  const texts = document.createTreeWalker(area.previousElementSibling!, NodeFilter.SHOW_TEXT);
  let before = start;
  let node = texts.nextNode();
  for (; node && before > node.textContent!.length; node = texts.nextNode()) before -= node.textContent!.length;
  if (!node) return;
  const range = document.createRange();
  range.setStart(node, before);
  range.setEnd(node, before);
  const { top } = range.getBoundingClientRect();
  let scroller = area.parentElement;
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (scroller) scroller.scrollTop += top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
  else window.scrollBy(0, top - window.innerHeight / 2);
}

type TextProps = Pick<Props, 'kind' | 'language'> & { text: string };

function Spans({ kind, language, text }: TextProps) {
  const pieces = useMemo(() => spansOf(kind, language, text), [kind, language, text]);
  return pieces.map((piece, index) => (
    <span key={index} className={piece.className}>
      {piece.text}
    </span>
  ));
}

// The text as the area draws it, to be read and not typed in.
export function MarkupText({ text, language }: { text: string; language?: CodeLanguage }) {
  return (
    <div className={styles.read}>
      <Spans kind="prompt" language={language} text={text} />
    </div>
  );
}

type FrameProps = Pick<Props, 'value' | 'onChange' | 'placeholder' | 'kind' | 'language' | 'ref'> & { id: string };

// Highlight and textarea must share exact font/weight/size/spacing or caret positions drift; headings brighten, never bold.
// Keep highlight in flow for height, textarea over it for input.
function Frame({ value, onChange, placeholder, kind, language, ref, id }: FrameProps) {
  return (
    <div className={styles.frame}>
      <div className={styles.layer} aria-hidden>
        <Spans kind={kind} language={language} text={value} />
      </div>
      <textarea id={id} ref={ref} className={styles.input} value={value} placeholder={placeholder} {...NO_AUTOFILL} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function MarkupArea({ label, value, onChange, placeholder, count, variant = 'page', kind = 'prompt', language, expand, aside, tools, foot, ref }: Props) {
  const id = useId();
  const big = useBigEdit(language ? expand : undefined, label, (copy) => language && <CodeField label={label} value={value} onChange={onChange} language={language} prose area={copy.area} caret={copy.caret} asides={aside && [aside(value)]} />, count);
  const frame = <Frame value={value} onChange={onChange} placeholder={placeholder} kind={kind} language={language} id={id} ref={ref} />;
  const name = (
    <label className={styles.label} htmlFor={id}>
      {label}
    </label>
  );
  if (tools !== undefined)
    return (
      <>
        <div className={styles.box} {...big.wrap}>
          {name}
          <div className={styles.tools}>
            <div className={styles.acts}>{tools}</div>
            {big.button}
          </div>
          <div className={styles.text}>{frame}</div>
          <div className={styles.foot}>
            <p className={styles.count}>{count}</p>
            {foot}
          </div>
        </div>
        {big.dialog}
      </>
    );
  return (
    <>
      <div className={variant === 'field' ? styles.field : undefined} {...big.wrap}>
        {name}
        {big.button ? (
          <div className={styles.beside}>
            {frame}
            {big.button}
          </div>
        ) : (
          frame
        )}
        {count && <p className={styles.count}>{count}</p>}
      </div>
      {big.dialog}
    </>
  );
}
