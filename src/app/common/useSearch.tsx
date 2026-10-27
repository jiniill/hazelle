import { useState, type ReactNode, type Ref } from 'react';
import { Empty, SearchField } from '../ui';
import { matches, noResults, SEARCH_FROM } from './search';

// Enter picks only a nonempty search's first result; otherwise it could select an item inside a hidden folder.
// Parent-owned query may outlive the list; ref lets callers focus on open.
export type SearchOptions<T> = { ref?: Ref<HTMLInputElement>; onEnter?: (first: T) => void; query?: readonly [string, (query: string) => void] };

// One list's search: the field shows from SEARCH_FROM items and stays while words are typed, so a list shrinking
// under a search keeps the field that filters it.
export function useSearch<T>(items: readonly T[], label: string, texts: (item: T) => string[], options: SearchOptions<T> = {}) {
  const own = useState('');
  const [query, setQuery] = options.query ?? own;
  const { ref, onEnter } = options;
  const words = query.trim();
  const found = words ? items.filter((item) => matches(words, ...texts(item))) : items;
  const first = found[0];
  const none = words !== '' && found.length === 0 ? noResults(words) : null;
  return {
    words,
    found,
    field: (items.length >= SEARCH_FROM || words !== '') && (
      <SearchField
        size="sm"
        label={label}
        value={query}
        onChange={setQuery}
        ref={ref}
        onKeyDown={
          onEnter &&
          ((event) => {
            if (event.key !== 'Enter' || !words || first === undefined) return;
            event.preventDefault();
            onEnter(first);
          })
        }
      />
    ),
    none,
    // Keep results/no-match copy in the list's own empty-state style.
    shown: (list: ReactNode, results: (found: readonly T[]) => ReactNode, empty: 'body' | 'section' = 'section') =>
      !words ? list : none === null ? results(found) : <Empty variant={empty}>{none}</Empty>,
  };
}
