import { act } from 'react';
import { expect, it, vi } from 'vitest';
import type { ApiResult } from '../../runtime/api';
import type { Page } from '../../runtime/pages';
import { probeRoot } from '../ui/probe';
import { usePages } from './useLoaded';

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
