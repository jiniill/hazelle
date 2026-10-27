import type { Toggle, ToggleLine } from '../../model/prompt';
import { toggleTree } from '../../model/toggles';
import type { ChatToggleSet, ToggleSource } from '../../runtime/chat-context';
import { laidOut, type Laid } from '../common/toggleLayout';

export type ToggleRow = { toggle: Toggle; value: string; changed: boolean };

// A text toggle's typed value waits under this key (common/useAutosave) before it is stored.
export const toggleSaveKey = (owner: string | null, key: string) => `toggle:${owner ?? ''}:${key}`;
export type ToggleSection = Pick<ToggleSource, 'from' | 'id' | 'name'> & { rows: ToggleRow[]; items: Laid<ToggleRow>[] };
type ToggleRows = { sections: ToggleSection[]; changed: number };

// A key declared again by a later source shows once, in the source that declares it (model/toggles chatToggles keeps
// the very line, so it is matched by identity). A source with no toggle of its own is left out.
export function toggleRows({ declared, sources, value }: ChatToggleSet): ToggleRows {
  const rows = new Map<ToggleLine, ToggleRow>(
    declared.map((toggle) => {
      const current = value(toggle.key)!;
      return [toggle, { toggle, value: current, changed: current !== toggle.default }];
    }),
  );
  const sections = sources
    .map(({ from, id, name, lines }) => ({
      from,
      id,
      name,
      rows: lines.flatMap((line) => rows.get(line) ?? []),
      items: asRisu(laidOut(toggleTree(lines), (line) => rows.get(line) ?? null)),
    }))
    .filter((section) => section.rows.length > 0);
  return { sections, changed: [...rows.values()].filter((row) => row.changed).length };
}

const repeated = (item: Laid<ToggleRow>, last: Laid<ToggleRow> | undefined) =>
  'note' in item && item.note.line.kind === 'divider' && last !== undefined && 'note' in last && last.note.line.kind === 'divider' && last.note.line.label === item.note.line.label;

// As Risu shows them: a group that holds nothing is left out, and a divider right after one of the same label shows once.
function asRisu(items: readonly Laid<ToggleRow>[]): Laid<ToggleRow>[] {
  const once = <I extends Laid<ToggleRow>>(list: readonly I[]) => list.filter((item, at) => !repeated(item, list[at - 1]));
  return once(items)
    .map((item) => ('group' in item ? { ...item, items: once(item.items) } : item))
    .filter((item) => !('group' in item) || item.items.length > 0);
}

// Freeze changed-filter membership when opened/refiltered so editing cannot remove the row under the pointer.
// Search/filter omit layout lines, which would misgroup partial results.
export function shownRows(rows: readonly ToggleRow[], found: ReadonlySet<ToggleRow>, onlyChanged: boolean, first: ReadonlySet<string>): ToggleRow[] {
  const kept = rows.filter((row) => found.has(row) && (!onlyChanged || row.changed));
  return [...kept.filter((row) => first.has(row.toggle.key)), ...kept.filter((row) => !first.has(row.toggle.key))];
}
