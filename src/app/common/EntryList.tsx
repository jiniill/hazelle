import { Fragment, useRef, useState, type ReactNode } from 'react';
import { moved } from '../../model/fields';
import { useOwnUndo } from '../toast';
import { Button, Empty, IconButton, openingFocus, Row } from '../ui';
import { ACTS } from './acts';

// move: its steps up and down, in a list whose order matters (reorder).
type Entry<T> = { value: T; index: number; name: string; set: (value: T) => void; remove: ReactNode; move: ReactNode };

type Props<T> = Place & {
  entries: T[];
  onChange: (entries: T[]) => void;
  name: (index: number) => string;
  blank: T;
  reorder?: boolean;
  addLabel: string;
  // The caller words it, so the particle after the noun is right.
  removed: (index: number) => string;
  children: (entry: Entry<T>) => ReactNode;
};

// Where the add stands: in a row before the entries (head), such as a setting's row in a group, or after them, and
// then an empty list says empty with the add under it as its first step.
type Place = { head: (add: { label: string; onClick: () => void }) => ReactNode; empty?: never } | { head?: never; empty: string };

// Undo inserts into the current list at its old position, clamped to the end if the list shrank.
export function EntryList<T>({ entries, onChange, name, blank, reorder = false, addLabel, empty, removed, head, children }: Props<T>) {
  const undoable = useOwnUndo();
  const latest = useRef({ entries, onChange });
  latest.current = { entries, onChange };
  function remove(index: number) {
    const gone = entries[index]!;
    onChange(entries.filter((_, at) => at !== index));
    undoable(removed(index), () => latest.current.onChange(latest.current.entries.toSpliced(index, 0, gone)));
  }
  // The entry the add button just made, whose first field takes the focus, which brings it into view.
  const [added, setAdded] = useState<number | null>(null);
  const add = {
    label: addLabel,
    onClick: () => {
      setAdded(entries.length);
      onChange([...entries, blank]);
    },
  };
  // The step just taken: its button on the entry where it now stands takes the focus, so pressing again carries the
  // same entry on. At an end, where that step is gone, the other one takes it. Once a step: a button that comes to
  // stand there later takes nothing.
  const [stepped, setStepped] = useState<{ at: number; up: boolean; turn: number } | null>(null);
  const took = useRef(0);
  const focus = (button: HTMLButtonElement | null) => {
    if (!button || took.current === stepped!.turn) return;
    took.current = stepped!.turn;
    button.focus();
  };
  const step = (index: number, up: boolean) => {
    const at = up ? index - 1 : index + 1;
    setStepped({ at, up: up ? at > 0 : at === entries.length - 1, turn: (stepped?.turn ?? 0) + 1 });
    onChange(moved(entries, index, at));
  };
  const steps = (index: number) =>
    ([true, false] as const)
      .filter((up) => (up ? index > 0 : index < entries.length - 1))
      .map((up) => {
        const act = up ? ACTS.moveUp : ACTS.moveDown;
        const lands = stepped?.at === index && stepped.up === up;
        return <IconButton key={act.label} ref={lands ? focus : undefined} icon={act.icon} label={`${name(index)} ${act.label}`} size="sm" onClick={() => step(index, up)} />;
      });
  const button = (
    <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={add.onClick}>
      {addLabel}
    </Button>
  );
  return (
    <>
      {head?.(add)}
      {entries.map((value, index) => (
        <Fragment key={index} ref={index === added ? openingFocus : undefined}>
          {children({
            value,
            index,
            name: name(index),
            set: (next) => onChange(entries.map((old, at) => (at === index ? next : old))),
            remove: <IconButton icon={ACTS.remove.icon} label={`${name(index)} ${ACTS.remove.label}`} size="sm" onClick={() => remove(index)} />,
            move: reorder && steps(index),
          })}
        </Fragment>
      ))}
      {/* In a row, so the column the list stands in does not stretch the button to its width. */}
      {!head && (entries.length === 0 ? <Empty variant="section" action={button}>{empty}</Empty> : <Row kind="actions">{button}</Row>)}
    </>
  );
}
