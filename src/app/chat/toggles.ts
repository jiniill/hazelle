import type { ToggleLine } from '../../model/prompt';
import { toggleTree, type ToggleNow } from '../../model/toggles';
import { sourceRows, type ChatToggleSet, type ToggleSource } from '../../runtime/chat/chat-context';
import { laidOut, type Laid } from '../common/toggleLayout';

export type ToggleRow = ToggleNow & { changed: boolean };

// A text toggle's typed value waits under this key (common/useAutosave) before it is stored.
export const toggleSaveKey = (owner: string | null, key: string) => `toggle:${owner ?? ''}:${key}`;
export type ToggleSection = Pick<ToggleSource, 'from' | 'id' | 'name' | 'presets'> & { rows: ToggleRow[]; items: Laid<ToggleRow>[] };
export type ToggleRows = { sections: ToggleSection[]; changed: number };

// A source with no toggle of its own is left out.
export function toggleRows(set: ChatToggleSet): ToggleRows {
  const sections = set.sources
    .map(({ from, id, name, lines, presets }) => {
      const rows = sourceRows(set, { lines }).map((row) => ({ ...row, changed: row.value !== row.toggle.default }));
      const byLine = new Map<ToggleLine, ToggleRow>(rows.map((row) => [row.toggle, row]));
      return { from, id, name, presets, rows, items: asRisu(laidOut(toggleTree(lines), (line) => byLine.get(line) ?? null)) };
    })
    .filter((section) => section.rows.length > 0);
  return { sections, changed: sections.flatMap(({ rows }) => rows).filter((row) => row.changed).length };
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
