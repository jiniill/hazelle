export type Json = Hazelle.Json;
export type Settings = Hazelle.Settings;
// Where every tool's own chat state lives among the chat's variables; the bot's are the rest.
export const TOOL_VARIABLES = 'tool:';
export const toolVar = (manifest: Pick<ToolManifest, 'author' | 'name'>, key: string) => `${TOOL_VARIABLES}${manifest.author}/${manifest.name}:${key}`;
export type ToolUse = 'model' | 'embed' | 'memory' | 'network';
// composer: the field is shown in the tool's composer popover too.
export type ToolField = { key: string; type: 'text' | 'number' | 'switch' | 'choice'; label: string; options?: string[]; default?: string | number | boolean; composer?: true };
// Risu import scan: missing lists refused/unmapped methods; hosts lists literal hosts.
// unread means API aliasing prevented an exhaustive scan.
export type RisuScan = { verdict: 'all' | 'partial' | 'unread'; missing: string[]; hosts: string[] };
// A //@tool line: a tool the chat model may call, answered by the 'tool' event. parameters: a JSON Schema object.
export type ToolFunction = { name: string; description: string; parameters: { [key: string]: Json } };
// Older tools omit actions/inputs/composer/functions and declare none; risu selects the v3 adapter.
export type ToolManifest = {
  api: 1; name: string; author: string; displayName: string; version: string; description: string; uses: ToolUse[]; page: { label: string } | null;
  menu: { id: string; label: string }[]; settings: ToolField[]; actions?: { id: string; label: string }[]; inputs?: { id: string; label: string }[]; composer?: { label: string } | null; functions?: ToolFunction[]; risu?: RisuScan;
};
