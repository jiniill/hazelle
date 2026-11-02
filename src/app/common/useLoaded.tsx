import { useEffect, useState, type ReactNode } from 'react';
import type { ApiResult } from '../../runtime/api';
import type { Page } from '../../runtime/pages';
import { Button, Callout, Empty, List, PostFeed, Text } from '../ui';
import { ACTS } from './acts';
import { describeFailure } from './failure';
import { count } from './typedNumber';
import { LOADING, SEE_ALL } from './words';

// A failed reload keeps what was shown. A change in deps asks again as reload does.
export function useLoaded<T>(load: (signal: AbortSignal) => Promise<ApiResult<T>>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setFailure(null);
    void load(abort.signal).then((answer) => {
      if (abort.signal.aborted) return;
      setFailure(answer.ok ? null : describeFailure(answer));
      if (answer.ok) setData(answer.data);
    });
    return () => abort.abort();
  }, [attempt, ...deps]);
  const reload = () => setAttempt((count) => count + 1);
  return {
    data,
    loading: data === null && failure === null && LOADING_NOTE,
    failure: failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: reload }}>{failure}</Callout>,
    reload,
  };
}

const LOADING_NOTE = <Text variant="note">{LOADING}</Text>;

// How many rows a list shows on a page that leads elsewhere to it whole (운영, 설정 › 계정): the newest, or what waits.
export const HEAD_ROWS = 5;

export function usePages<T>(load: (after: string | null) => Promise<ApiResult<Page<T>>>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // after: the page that failed, which 다시 시도 asks for again.
  const [failure, setFailure] = useState<{ text: string; after: string | null } | null>(null);

  async function fetch(after: string | null, live = () => true) {
    setBusy(true);
    setFailure(null);
    const answer = await load(after);
    if (!live()) return;
    setBusy(false);
    setFailure(answer.ok ? null : { text: describeFailure(answer), after });
    if (!answer.ok) return;
    setRows((shown) => (after === null ? answer.data.rows : [...(shown ?? []), ...answer.data.rows]));
    setNext(answer.data.next);
  }

  useEffect(() => {
    let live = true;
    void fetch(null, () => live);
    return () => {
      live = false;
    };
  }, []);

  return {
    rows,
    busy,
    // Every row is in hand: a head that is whole needs no door to the rest.
    whole: rows !== null && next === null,
    loading: rows === null && failure === null && LOADING_NOTE,
    failure: failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => void fetch(failure.after) }}>{failure.text}</Callout>,
    more: next !== null && (
      <Button variant="ghost" size="sm" busy={busy} onClick={() => void fetch(next)}>
        더 보기
      </Button>
    ),
    // After an act that changed rows not in hand, such as every report on one share: the first page again.
    reload: () => void fetch(null),
    update: (change: (shown: T[]) => T[]) => setRows((shown) => shown && change(shown)),
  };
}

// The door to the rest of a list: a page when total is unknown (the list pages), else the same place, folding back with 접기.
export function SeeAll({ total, open = false, onClick }: { total?: number; open?: boolean; onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      {open ? '접기' : total === undefined ? SEE_ALL : `${SEE_ALL} (${count(total)})`}
    </Button>
  );
}

// A paged list's body. head: the few a page shows beside its door to the rest, so it pages no further.
// feed: rows that are cards of their own (PostCard), not a box of rows.
export function PagedList<T>({ pages, head, label, empty, feed = false, children }: { pages: ReturnType<typeof usePages<T>>; head: boolean; label: string; empty: string; feed?: boolean; children: (row: T) => ReactNode }) {
  const { rows } = pages;
  return (
    <>
      {pages.loading}
      {pages.failure}
      {rows && rows.length === 0 && <Empty variant="section">{empty}</Empty>}
      {rows && rows.length > 0 &&
        (feed ? (
          <PostFeed label={label}>{rows.map(children)}</PostFeed>
        ) : (
          <List label={label} box>
            {rows.map(children)}
          </List>
        ))}
      {!head && pages.more}
    </>
  );
}
