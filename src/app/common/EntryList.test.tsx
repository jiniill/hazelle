import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { EntryList } from './EntryList';

vi.mock('../toast', () => ({ useOwnUndo: () => vi.fn() }));

it('says an empty list is empty with its add under the words, and keeps the add in a row of its own after entries', () => {
  const shown = (entries: string[]) =>
    renderToStaticMarkup(
      <EntryList entries={entries} onChange={() => {}} name={(index) => `변수 ${index + 1}`} blank="" addLabel="변수 추가" empty="변수가 없어요." removed={() => ''}>
        {({ value }) => <span>{value}</span>}
      </EntryList>,
    );
  const empty = shown([]);
  expect(empty).toMatch(/<p[^>]*>변수가 없어요\.<\/p>.*변수 추가/);
  const listed = shown(['a']);
  expect(listed).not.toContain('변수가 없어요.');
  expect(listed).toMatch(/<span>a<\/span><div class="[^"]*row[^"]*"><button[^>]*>.*변수 추가/);
});

it('steps an entry up or down only where its list keeps an order, and not past an end', () => {
  const onChange = vi.fn();
  const shown = (reorder: boolean) =>
    renderToStaticMarkup(
      <EntryList entries={['a', 'b', 'c']} onChange={onChange} name={(index) => `첫인사 ${index + 1}`} blank="" reorder={reorder} addLabel="첫인사 추가" empty="" removed={() => ''}>
        {({ value, move }) => (
          <span>
            {value}
            {move}
          </span>
        )}
      </EntryList>,
    );
  expect(shown(false)).not.toContain('옮기기');
  const labels = [...shown(true).matchAll(/aria-label="(첫인사 \d [^"]*옮기기)"/g)].map((match) => match[1]);
  expect(labels).toEqual(['첫인사 1 아래로 옮기기', '첫인사 2 위로 옮기기', '첫인사 2 아래로 옮기기', '첫인사 3 위로 옮기기']);
});
