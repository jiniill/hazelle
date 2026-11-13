import { badgesOf, type ToolChatData } from '../../model/tool';
import type { ToolField } from '../../tool-api/manifest';
import type { MenuItem, ToolMenu } from '../../runtime/tools/facade';

type ToolAction = { module: string; name: string; label: string } & ({ kind: 'page' } | { kind: 'menu'; item: string });

// items: the tool host's, which a frame tool's frame registers while it runs.
export const toolMenu = (tools: ToolMenu[], items: (module: string) => MenuItem[]): ToolAction[] => tools.flatMap(({ module, manifest }) => [
  ...(manifest.page ? [{ kind: 'page' as const, module, name: manifest.displayName, label: manifest.page.label }] : []),
  ...items(module).map(({ id, label }) => ({ kind: 'menu' as const, module, name: manifest.displayName, label, item: id })),
]);

// A message's 도구 menu: each tool's message actions, by tool in pack order. actions: the tool host's, which a frame
// tool's frame registers while it runs.
type ToolActions ={ module: string; name: string; items: MenuItem[] };
export const toolActions = (tools: ToolMenu[], actions: (module: string) => MenuItem[]): ToolActions[] => tools.flatMap(({ module, manifest }) => {
  const items = actions(module);
  return items.length ? [{ module, name: manifest.displayName, items }] : [];
});

// A //@composer item: its button, its //@input items, and the settings fields it shows, which are the module's own in
// every chat.
export type ToolComposer = { module: string; name: string; label: string; inputs: MenuItem[]; fields: ToolField[]; page: boolean };
export const toolComposer = (tools: ToolMenu[]): ToolComposer[] => tools.flatMap(({ module, manifest }) => manifest.composer ? [{
  module, name: manifest.displayName, label: manifest.composer.label, inputs: manifest.inputs ?? [], fields: manifest.settings.filter((field) => field.composer), page: manifest.page !== null,
}] : []);

export const toolIsOn = (tool: ToolComposer, settings: Record<string, unknown>) => tool.fields.some((field) => field.type === 'switch' && settings[field.key] === true);

export const pressRuns = (tool: ToolComposer): MenuItem | null => tool.inputs.length === 1 && !tool.fields.length && !tool.page ? tool.inputs[0]! : null;

const BADGE_CHARS = 10;

// Each version's badges, one a tool, in pack order. A badge stands on the version it was put on: another version shown
// hides it, and showing that one again brings it back.
export function badgesByVersion(rows: readonly { value: ToolChatData }[], tools: ToolMenu[]): ReadonlyMap<string, string[]> {
  const order = new Map(tools.map(({ module }, index) => [module, index]));
  const records = rows.flatMap(({ value }) => {
    const badges = badgesOf(value);
    return badges && order.has(value.module) ? [{ module: value.module, badges }] : [];
  }).sort((a, b) => order.get(a.module)! - order.get(b.module)!);
  const versions = new Map<string, string[]>();
  for (const { badges } of records) {
    for (const { version, text } of Object.values(badges)) {
      const badge = [...text].slice(0, BADGE_CHARS).join('');
      const badges = versions.get(version);
      if (badges) badges.push(badge);
      else versions.set(version, [badge]);
    }
  }
  return versions;
}

export function inToolOrder<T extends { key: string }>(tools: readonly T[], order: readonly string[]): T[] {
  const rank = (tool: T) => (order.includes(tool.key) ? order.indexOf(tool.key) : order.length);
  return [...tools].sort((a, b) => rank(a) - rank(b));
}

// The tools behind the composer's menu: the account's hidden ones where its tools stand in a row, every one where
// there is no row. The account's choice is kept as it is under a composer with no row, neither shown nor written.
export const behindMenu = (tools: readonly { key: string }[], hiddenTools: readonly string[], row: boolean): ReadonlySet<string> => new Set(row ? hiddenTools : tools.map((tool) => tool.key));

// What stands by the field: a tool not behind the menu, and one behind it while it runs, its button being the only stop.
export const standing = <T extends { key: string; running?: boolean }>(tools: readonly T[], behind: ReadonlySet<string>) => tools.filter((tool) => !behind.has(tool.key) || tool.running);
