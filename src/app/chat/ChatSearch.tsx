import { X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { SHORTCUTS } from '../shortcuts';
import { IconButton, pressed, SearchField, Switcher, titled } from '../ui';
import type { useChatSearch } from './useChatSearch';

type Search = ReturnType<typeof useChatSearch>;

type Props = {
  search: NonNullable<Search['search']>;
  onSearch: (term: string) => void;
  onStep: (step: -1 | 1) => void;
  onClose: () => void;
};

export function ChatSearch({ search, onSearch, onStep, onClose }: Props) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!search.focus) return;
    field.current?.focus();
    field.current?.select();
  }, [search.focus]);

  // Each key is taken here, so Esc closes the bar alone: not a menu (layers.ts), not 답장 멈추기, and not the
  // browser's own clearing of a search field.
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = pressed(event, SHORTCUTS.findNext.keys) ? 1 : pressed(event, SHORTCUTS.findPrevious.keys) ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      onStep(step);
    } else if (pressed(event, SHORTCUTS.closeFind.keys)) {
      event.preventDefault();
      onClose();
    }
  };
  const none = search.hits === 0;
  return (
    <SearchField
      ref={field}
      label={SHORTCUTS.find.label}
      size="sm"
      grow
      value={search.term}
      onChange={onSearch}
      onKeyDown={keys}
      after={
        <>
          <Switcher
            count={search.term.trim() ? `${search.place ?? (none ? 0 : '–')} / ${search.hits}` : ''}
            prev={{ label: SHORTCUTS.findPrevious.label, title: titled(SHORTCUTS.findPrevious.label, SHORTCUTS.findPrevious.keys), disabled: none, onClick: () => onStep(-1) }}
            next={{ label: SHORTCUTS.findNext.label, title: titled(SHORTCUTS.findNext.label, SHORTCUTS.findNext.keys), disabled: none, onClick: () => onStep(1) }}
            axis="down"
          />
          <IconButton icon={X} size="sm" label={SHORTCUTS.closeFind.label} title={titled(SHORTCUTS.closeFind.label, SHORTCUTS.closeFind.keys)} onClick={onClose} />
        </>
      }
    />
  );
}
