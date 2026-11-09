import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shown } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import type { Translating } from '../../runtime/translate';
import type { Seek } from '../ui';
import { finder, seenText } from './search';

// What 채팅 검색 opened the chat with: its term, and the message it was found in.
export type SearchSeed = { term: string; at: string };

export function useChatSearch(messages: Shown[], texts: string[], translating: Translating, flipped: ReadonlySet<string>, shownTranslation: (text: string) => string, seekTo: (key: string, lands: Seek['lands']) => void, seed: SearchSeed | null) {
  const [found, setFound] = useState<{ ids: ReadonlySet<string>; at: number } | null>(null);
  // The search bar's term and current hit, by message id so rows coming and going keep it. focus asks the field to take
  // the focus again, as Ctrl+F does while the bar is open; 0, a bar opened with the chat, leaves the focus where it is,
  // so a phone's keyboard does not cover the message it landed on.
  const [search, setSearch] = useState<{ term: string; at: string | null; focus: number } | null>(seed && { ...seed, focus: 0 });
  // The view goes to the seed's message once the story holds it, whether its shown text holds the term or not.
  const landed = useRef(seed === null);
  useLayoutEffect(() => {
    if (landed.current || !messages.some(({ id }) => id === seed!.at)) return;
    landed.current = true;
    seekTo(seed!.at, 'center');
  }, [messages]);
  const [find] = useState(finder);
  const readAs = (message: Shown, index: number) => {
    const version = shown(message);
    return seenText(texts[index]!, version, translating.live.get(version.id) ?? null, flipped.has(version.id), shownTranslation);
  };
  const hitsFor = (term: string) => find(messages.map(readAs), term).map((index) => messages[index]!.id);
  const hits = useMemo(() => (search ? hitsFor(search.term) : []), [search?.term, messages, texts, translating, flipped, shownTranslation]);
  // null with no current hit, or when its message was deleted.
  const searchAt = search?.at != null && hits.includes(search.at) ? search.at : null;

  // A new term starts at the newest hit, nearest where a chat is read.
  function searchFor(term: string) {
    const at = hitsFor(term).at(-1) ?? null;
    setSearch((current) => current && { ...current, term, at });
    if (at) seekTo(at, 'center');
  }

  function stepSearch(step: -1 | 1) {
    if (!hits.length) return;
    const index = searchAt === null ? (step > 0 ? -1 : hits.length) : hits.indexOf(searchAt);
    const at = hits[(index + step + hits.length) % hits.length]!;
    setSearch((current) => current && { ...current, at });
    seekTo(at, 'center');
  }

  return {
    found,
    // place: the current hit's 1-based place among hits, null when there is none.
    search: search && { term: search.term, focus: search.focus, hits: hits.length, place: searchAt === null ? null : hits.indexOf(searchAt) + 1, at: searchAt },
    actions: {
      // ids in chat order; the view goes to the first.
      find: (ids: string[]) => {
        if (!ids.length) return;
        seekTo(ids[0]!, 'center');
        setFound({ ids: new Set(ids), at: Date.now() });
      },
      openSearch: () => setSearch((current) => ({ term: current?.term ?? '', at: current?.at ?? null, focus: (current?.focus ?? 0) + 1 })),
      searchFor,
      stepSearch,
      closeSearch: () => setSearch(null),
    },
  };
}
