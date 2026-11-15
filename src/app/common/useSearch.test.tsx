import { act, type ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { SEARCH_FROM } from './search';
import { useSearch } from './useSearch';

it('keeps the field while words are typed after the list shrinks, and finds nothing missing without words', async () => {
  let search: ReturnType<typeof useSearch<string>>;
  function Probe({ items }: { items: string[] }) {
    search = useSearch(items, '검색', (item) => [item]);
    return null;
  }
  const many = Array.from({ length: SEARCH_FROM }, (_, index) => `항목 ${index}`);
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe items={[]} />));
    expect(search!.field).toBe(false);
    expect(search!.none).toBeNull();
    await act(() => root.render(<Probe items={many} />));
    await act(() => (search!.field as ReactElement<{ onChange: (value: string) => void }>).props.onChange('항목 1'));
    await act(() => root.render(<Probe items={many.slice(0, 2)} />));
    expect(search!.field).toBeTruthy();
    expect(search!.found).toEqual(['항목 1']);
    expect(search!.none).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('picks the first one found on Enter, but not with no words nor while a syllable is being composed', async () => {
  const picked: string[] = [];
  let search: ReturnType<typeof useSearch<string>>;
  function Probe() {
    search = useSearch(Array.from({ length: SEARCH_FROM }, (_, at) => `항목 ${at}`), '검색', (item) => [item], { onEnter: (first) => picked.push(first) });
    return null;
  }
  const field = () => (search!.field as ReactElement<{ onChange: (value: string) => void; onKeyDown: (event: unknown) => void }>).props;
  const enter = (isComposing: boolean) => field().onKeyDown({ key: 'Enter', nativeEvent: { isComposing, keyCode: 0 }, preventDefault() {} });
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    enter(false);
    await act(() => field().onChange('항목'));
    enter(true);
    expect(picked).toEqual([]);
    enter(false);
    expect(picked).toEqual(['항목 0']);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
