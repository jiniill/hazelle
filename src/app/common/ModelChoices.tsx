import { refOf, sameModelRef, type ModelRef } from '../../connectors/assignment';
import { entryName, entryTerms } from '../../connectors/types';
import type { Route } from '../../runtime/models/assignment';
import { Empty, MenuHeading, MenuItem, useMenuClose } from '../ui';
import { useSearch } from './useSearch';
import { noStarred, searchOf, STARRED } from './words';

type Props = {
  // Each connection's models together.
  routes: readonly Route[];
  // The one picked, null while none is; absent where a press adds a model instead of picking one.
  current?: ModelRef | null;
  // Some of routes, shown first: they mix connections, so each names its own, and its group leaves it out.
  recent?: readonly Route[];
  describe?: (route: Route) => string;
  onPick: (ref: ModelRef) => void;
};

// The added models a menu offers, under a heading wherever the connection changes: same-named models on two
// connections differ by heading, not by a grey line under each.
// Mounted only while the menu is open, so each opening starts with an empty search.
export function ModelChoices({ routes, current, recent = [], describe, onPick }: Props) {
  const close = useMenuClose();
  const refTo = ({ connection, model }: Route) => refOf(connection.id, model);
  // Enter in the search picks the first one found, as a press on its row would.
  const search = useSearch(routes, searchOf(STARRED), ({ connection, model }) => [...entryTerms(model), connection.value.label], {
    onEnter: (route) => {
      close();
      onPick(refTo(route));
    },
  });
  const item = (route: Route, description = describe?.(route)) => {
    const ref = refTo(route);
    return <MenuItem key={`${ref.connection}/${ref.model}`} label={entryName(route.model)} description={description} checked={current === undefined ? undefined : !!current && sameModelRef(ref, current)} onClick={() => onPick(ref)} />;
  };
  if (routes.length === 0) return <Empty variant="menu">{noStarred('선택할 수 있어요')}</Empty>;
  const first = search.words ? [] : recent;
  const grouped = search.found.filter((route) => !first.includes(route));
  return (
    <>
      {search.field}
      {search.none && <Empty variant="menu">{search.none}</Empty>}
      {first.length > 0 && <MenuHeading>최근</MenuHeading>}
      {first.map((route) => item(route, route.connection.value.label))}
      {grouped.flatMap((route, at) =>
        grouped[at - 1]?.connection.id === route.connection.id ? [item(route)] : [<MenuHeading key={`heading/${route.connection.id}`}>{route.connection.value.label}</MenuHeading>, item(route)],
      )}
    </>
  );
}
