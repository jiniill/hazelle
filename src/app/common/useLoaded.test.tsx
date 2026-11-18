import { act } from 'react';
import { expect, it, vi } from 'vitest';
import type { ApiResult } from '../../runtime/api';
import type { Page } from '../../runtime/service/pages';
import { probeRoot } from '../ui/probe';
import { useLoad, usePages, useShown } from './useLoaded';

it('retries the page that failed, so a reload that failed is asked again from the first page', async () => {
  const asked: (string | null)[] = [];
  let fail = false;
  const load = async (after: string | null): Promise<ApiResult<Page<string>>> => {
    asked.push(after);
    if (fail) return { ok: false, error: 'offline' };
    return { ok: true, data: after === null ? { rows: ['a'], next: 'b' } : { rows: ['b'], next: null } };
  };
  let pages: ReturnType<typeof usePages<string>>;
  function Probe() {
    pages = usePages(load);
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    fail = true;
    await act(async () => pages!.reload());
    expect(pages!.failure).toBeTruthy();
    fail = false;
    await act(async () => (pages!.failure as { props: { action: { onClick: () => void } } }).props.action.onClick());
    expect(asked).toEqual([null, null, null]);
    expect(pages!.rows).toEqual(['a']);
    await act(() => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});

type Retry = { props: { action: { onClick: () => void }; children: string } };

it('drops the answer of an ask its deps replaced, keeps what was shown past a failed reload and asks again on 다시 시도', async () => {
  const signals: AbortSignal[] = [];
  let answer: (key: string) => Promise<string> = async (key) => key;
  let loaded: ReturnType<typeof useLoad<string>>;
  function Probe({ dep }: { dep: string }) {
    loaded = useLoad((signal) => {
      signals.push(signal);
      return answer(dep);
    }, [dep], { describe: (error) => `failed ${String(error)}`, keep: true });
    return null;
  }
  const root = probeRoot();
  try {
    let late!: (value: string) => void;
    answer = () => new Promise((resolve) => (late = resolve));
    await act(() => root.render(<Probe dep="a" />));
    expect(loaded!.loading).toBe(true);
    answer = async (key) => key;
    await act(() => root.render(<Probe dep="b" />));
    expect(signals[0]!.aborted).toBe(true);
    await act(async () => late('a'));
    expect(loaded!.data).toBe('b');
    answer = async () => Promise.reject(new Error('offline'));
    await act(async () => loaded!.reload());
    expect(loaded!.data).toBe('b');
    expect((loaded!.failure as Retry).props.children).toBe('failed Error: offline');
    answer = async () => 'c';
    await act(async () => (loaded!.failure as Retry).props.action.onClick());
    expect(loaded!.failure).toBeNull();
    expect(loaded!.data).toBe('c');
    await act(() => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});

it('shows a held list a page at a time, from the row that must show, and drops the door once every row shows', async () => {
  let shown: ReturnType<typeof useShown<number>>;
  function Probe() {
    shown = useShown([1, 2, 3, 4, 5, 6, 7], 2, 3);
    return null;
  }
  const root = probeRoot();
  await act(() => root.render(<Probe />));
  expect(shown!.rows).toEqual([1, 2, 3]);
  await act(async () => (shown!.more as { props: { onClick: () => void } }).props.onClick());
  expect(shown!.rows).toEqual([1, 2, 3, 4, 5]);
  await act(async () => (shown!.more as { props: { onClick: () => void } }).props.onClick());
  expect(shown!.rows).toHaveLength(7);
  expect(shown!.more).toBe(false);
  await act(() => root.unmount());
});
