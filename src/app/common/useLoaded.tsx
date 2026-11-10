import { useEffect, useState, type ReactNode } from 'react';
import type { ApiFailure, ApiResult } from '../../runtime/api';
import type { Page } from '../../runtime/service/pages';
import { Button, Callout, Empty, List, PostFeed, Text } from '../ui';
import { ACTS } from './acts';
import { describeFailure } from './failure';
import { count } from './typedNumber';
import { LOADING, SEE_ALL } from './words';

// The one load protocol: asked on mount, on a change in deps and on reload, an older ask's answer dropped (its signal
// aborted), nothing asked while skip. keep: what was shown stays while the next answer comes and after a failed one;
// without it each ask starts from nothing. describe: what a thrown error says, by the loader's own failure types.
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], { describe, skip = false, keep = false }: { describe: (error: unknown) => string; skip?: boolean; keep?: boolean }) {
  const [data, setData] = useState<T>();
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!keep) setData(undefined);
    if (skip) return;
    const abort = new AbortController();
    setFailure(null);
    load(abort.signal).then(
      (value) => !abort.signal.aborted && setData(value),
      (error: unknown) => !abort.signal.aborted && setFailure(describe(error)),
    );
    return () => abort.abort();
  }, [attempt, skip, ...deps]);
  const reload = () => setAttempt((count) => count + 1);
  return {
    data,
    loading: data === undefined && failure === null,
    failure: failure === null ? null : <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: reload }}>{failure}</Callout>,
    reload,
  };
}

export function useLoaded<T>(load: (signal: AbortSignal) => Promise<ApiResult<T>>, deps: unknown[] = []) {
  const loaded = useLoad(
    async (signal) => {
      const answer = await load(signal);
      if (answer.ok) return answer.data;
      throw answer;
    },
    deps,
    { describe: (failure) => describeFailure(failure as ApiFailure), keep: true },
  );
  return {
    data: loaded.data ?? null,
    loading: loaded.loading && LOADING_NOTE,
    failure: loaded.failure,
    reload: loaded.reload,
    refresh: <Refresh onClick={loaded.reload} />,
  };
}

const LOADING_NOTE = <Text variant="note">{LOADING}</Text>;

function Refresh({ busy, onClick }: { busy?: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" busy={busy} onClick={onClick}>
      새로고침
    </Button>
  );
}

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
    refresh: <Refresh busy={busy} onClick={() => void fetch(null)} />,
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
export function PagedList<T>({ pages, head, label, empty, feed = false, places = false, children }: { pages: ReturnType<typeof usePages<T>>; head: boolean; label: string; empty: string; feed?: boolean; places?: boolean; children: (row: T) => ReactNode }) {
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
          <List label={label} box places={places}>
            {rows.map(children)}
          </List>
        ))}
      {!head && pages.more}
    </>
  );
}
