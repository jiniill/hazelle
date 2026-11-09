import { Fragment, useRef, useState, type ReactNode } from 'react';
import { useOwnUndo } from '../toast';
import { Button, Empty, IconButton, Row } from '../ui';
import { ACTS } from './acts';

// added: the entry the add button just made, whose first field takes the focus, which brings it into view.
type Entry<T> = { value: T; index: number; name: string; added: boolean; set: (value: T) => void; remove: ReactNode };

type Props<T> = Place & {
  entries: T[];
  onChange: (entries: T[]) => void;
  name: (index: number) => string;
  blank: T;
  addLabel: string;
  // The caller words it, so the particle after the noun is right.
  removed: (index: number) => string;
  children: (entry: Entry<T>) => ReactNode;
};

// Where the add stands: in a row before the entries (head), such as a setting's row in a group, or after them, and
// then an empty list says empty with the add under it as its first step.
type Place = { head: (add: { label: string; onClick: () => void }) => ReactNode; empty?: never } | { head?: never; empty: string };

// Undo inserts into the current list at its old position, clamped to the end if the list shrank.
export function EntryList<T>({ entries, onChange, name, blank, addLabel, empty, removed, head, children }: Props<T>) {
  const undoable = useOwnUndo();
  const latest = useRef({ entries, onChange });
  latest.current = { entries, onChange };
  function remove(index: number) {
    const gone = entries[index]!;
    onChange(entries.filter((_, at) => at !== index));
    undoable(removed(index), () => latest.current.onChange(latest.current.entries.toSpliced(index, 0, gone)));
  }
  const [added, setAdded] = useState<number | null>(null);
  const add = {
    label: addLabel,
    onClick: () => {
      setAdded(entries.length);
      onChange([...entries, blank]);
    },
  };
  const button = (
    <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={add.onClick}>
      {addLabel}
    </Button>
  );
  return (
    <>
      {head?.(add)}
      {entries.map((value, index) => (
        <Fragment key={index}>
          {children({
            value,
            index,
            name: name(index),
            added: index === added,
            set: (next) => onChange(entries.map((old, at) => (at === index ? next : old))),
            remove: <IconButton icon={ACTS.remove.icon} label={`${name(index)} ${ACTS.remove.label}`} size="sm" onClick={() => remove(index)} />,
          })}
        </Fragment>
      ))}
      {/* In a row, so the column the list stands in does not stretch the button to its width. */}
      {!head && (entries.length === 0 ? <Empty variant="section" action={button}>{empty}</Empty> : <Row kind="actions">{button}</Row>)}
    </>
  );
}
