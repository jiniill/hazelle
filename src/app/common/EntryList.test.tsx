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
