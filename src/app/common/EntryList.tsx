import { Fragment, useRef, type ReactNode } from 'react';
import { useOwnUndo } from '../toast';
import { Button, IconButton } from '../ui';
import { ACTS } from './acts';

type Entry<T> = { value: T; index: number; name: string; set: (value: T) => void; remove: ReactNode };

type Props<T> = {
  entries: T[];
  onChange: (entries: T[]) => void;
  name: (index: number) => string;
  blank: T;
  addLabel: string;
  // The caller words it, so the particle after the noun is right.
  removed: (index: number) => string;
  // A row before the entries that holds the add, in place of the button after them, such as a setting's row in a group.
  head?: (add: { label: string; onClick: () => void }) => ReactNode;
  children: (entry: Entry<T>) => ReactNode;
};

// Undo inserts into the current list at its old position, clamped to the end if the list shrank.
export function EntryList<T>({ entries, onChange, name, blank, addLabel, removed, head, children }: Props<T>) {
  const undoable = useOwnUndo();
  const latest = useRef({ entries, onChange });
  latest.current = { entries, onChange };
  function remove(index: number) {
    const gone = entries[index]!;
    onChange(entries.filter((_, at) => at !== index));
    undoable(removed(index), () => latest.current.onChange(latest.current.entries.toSpliced(index, 0, gone)));
  }
  const add = { label: addLabel, onClick: () => onChange([...entries, blank]) };
  return (
    <>
      {head?.(add)}
      {entries.map((value, index) => (
        <Fragment key={index}>
          {children({
            value,
            index,
            name: name(index),
            set: (next) => onChange(entries.map((old, at) => (at === index ? next : old))),
            remove: <IconButton icon={ACTS.remove.icon} label={`${name(index)} ${ACTS.remove.label}`} size="sm" onClick={() => remove(index)} />,
          })}
        </Fragment>
      ))}
      {!head && (
        <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={add.onClick}>
          {addLabel}
        </Button>
      )}
    </>
  );
}
