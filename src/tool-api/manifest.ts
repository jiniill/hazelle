export type Json = Hazelle.Json;
export type Settings = Hazelle.Settings;
// Where every tool's own chat state lives among the chat's variables; the bot's are the rest.
export const TOOL_VARIABLES = 'tool:';
// One stored value of a tool's data as a row: bound by the largest sealed body a batch takes (contracts/objects
// BATCH_LIMITS.body). The sandbox refuses a chat value past it where it is set; the host holds it again (runtime/tools/store).
export const TOOL_ROW_BYTES = 512 * 1024;
export const TOOL_KEY_CHARS = 256;
// What a tool says it is doing (Chat.progress), as the waiting mark shows it beside its name.
export const TOOL_PROGRESS_CHARS = 40;
// One line of a test run's record: a call's arguments, its answer, a console line.
export const TOOL_LOG_CHARS = 200;
const encoder = new TextEncoder();
export const dataBytes = (key: string, value: Json) => encoder.encode(key).byteLength + encoder.encode(JSON.stringify(value)).byteLength;
export const toolVar = (manifest: Pick<ToolManifest, 'author' | 'name'>, key: string) => `${TOOL_VARIABLES}${manifest.author}/${manifest.name}:${key}`;
// The most pictures a tool keeps on one message version, each under a slot of its own (Chat.picture).
export const PICTURE_SLOTS = 8;
// The most pictures one model call carries (Chat.model).
export const MODEL_PICTURES = 6;
export const TOOL_USES = ['model', 'embed', 'decide', 'draw', 'memory', 'illustrate', 'network'] as const;
export type ToolUse = (typeof TOOL_USES)[number];
// The uses that spend on a model, which the user answers as one.
export const callsModels = (uses: readonly ToolUse[]) => uses.some((use) => use === 'model' || use === 'embed' || use === 'decide' || use === 'draw');
// composer: the field is shown in the tool's composer popover too.
export type ToolField = { key: string; type: 'text' | 'number' | 'switch' | 'choice'; label: string; options?: string[]; default?: string | number | boolean; composer?: true };
// Risu import scan: missing lists refused/unmapped methods; hosts lists literal hosts.
// unread means API aliasing prevented an exhaustive scan.
export type RisuScan = { verdict: 'all' | 'partial' | 'unread'; missing: string[]; hosts: string[] };
// A //@tool line: a tool the chat model may call, answered by the 'tool' event. parameters: a JSON Schema object.
export type ToolFunction = { name: string; description: string; parameters: { [key: string]: Json } };
// A //@model line: a model of the plugin's own, called by its id (Chat.model) and picked by the user on the plugin's page.
export type ToolModel = { id: string; label: string };
// Older tools omit actions/inputs/composer/functions/models and declare none; risu selects the v3 adapter.
export type ToolManifest = {
  api: 1; name: string; author: string; displayName: string; version: string; description: string; uses: ToolUse[]; page: { label: string } | null;
  menu: { id: string; label: string }[]; settings: ToolField[]; actions?: { id: string; label: string }[]; inputs?: { id: string; label: string }[]; composer?: { label: string } | null; functions?: ToolFunction[]; models?: ToolModel[]; risu?: RisuScan;
};
