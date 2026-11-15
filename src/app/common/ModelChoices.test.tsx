import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Route } from '../../runtime/models/assignment';
import { SEARCH_FROM } from './search';
import { ModelChoices } from './ModelChoices';
import type { SearchOptions } from './useSearch';

// The search as it is, and what the list asked of it.
let asked: SearchOptions<Route> | undefined;
vi.mock('./useSearch', async (original) => {
  const { useSearch } = await original<typeof import('./useSearch')>();
  return {
    useSearch: (...args: Parameters<typeof useSearch<Route>>) => {
      asked = args[3];
      return useSearch(...args);
    },
  };
});

const route = (connection: string, id: string): Route => ({ connection: { id: connection, value: { label: connection } }, model: { id, name: id } }) as never;
const shown = (props: Partial<Parameters<typeof ModelChoices>[0]> & { routes: Route[] }) => renderToStaticMarkup(<ModelChoices onPick={() => {}} {...props} />);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

it('heads each connection once, so same-named models on two connections differ by heading', () => {
  const routes = [route('Anthropic', 'opus'), route('Anthropic', 'fable'), route('Copilot', 'carbon'), route('Google', 'carbon')];
  expect(text(shown({ routes, current: { connection: 'Google', model: 'carbon' } }))).toBe('Anthropic opus fable Copilot carbon Google carbon');
});

it('shows recent ones first, each naming its connection, and leaves them out of their groups', () => {
  const routes = [route('Anthropic', 'opus'), route('Anthropic', 'fable'), route('Copilot', 'carbon')];
  expect(text(shown({ routes, recent: [routes[2]!, routes[1]!] }))).toBe('최근 carbon Copilot fable Anthropic Anthropic opus');
});

it('marks the picked one among radios, and draws plain rows where a press adds a model', () => {
  const routes = [route('Anthropic', 'opus'), route('Anthropic', 'fable')];
  expect(shown({ routes, current: { connection: 'Anthropic', model: 'fable' } }).match(/role="menuitemradio" aria-checked="(true|false)"/g)).toEqual([
    'role="menuitemradio" aria-checked="false"',
    'role="menuitemradio" aria-checked="true"',
  ]);
  expect(shown({ routes, describe: () => '현재: 없음' })).not.toContain('menuitemradio');
});

it('offers a search from SEARCH_FROM models on', () => {
  const routes = Array.from({ length: SEARCH_FROM }, (_, at) => route('Anthropic', `m${at}`));
  expect(shown({ routes })).toContain('추가한 모델 검색');
  expect(shown({ routes: routes.slice(1) })).not.toContain('추가한 모델 검색');
});

it('picks the first one found when Enter is pressed in the search', () => {
  const routes = [route('Anthropic', 'opus'), route('Copilot', 'carbon')];
  const picked: unknown[] = [];
  renderToStaticMarkup(<ModelChoices routes={routes} onPick={(ref) => picked.push(ref)} />);
  asked!.onEnter!(routes[1]!);
  expect(picked).toEqual([{ connection: 'Copilot', model: 'carbon' }]);
});
