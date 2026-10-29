import type { Cost } from '../connectors/types';
import type { ModelRef } from '../connectors/assignment';
import type { Json, Settings, ToolManifest } from '../tool-api/manifest';
import type { FileRef } from '../vault/files';
import { inverted } from './memory';

export type Tool = { manifest: ToolManifest; file: FileRef; size: number; settings: Settings };
export type DraftAsk = { ask: string; note: string; model: ModelRef; cost: Cost | null; at: number };
export type ToolDraft = { text: string; module: string | null; applied: string | null; asks: DraftAsk[]; at: number };
export type ToolData = { key: string; value: Json };
// Keys live in either tool or toolfile, never both; oversized JSON uses a file (tools/store TOOL_ROW_BYTES).
export type ToolFile = { key: string; size: number; file: FileRef };
// key null stores host-owned Badges rather than tool chat data.
export type ToolChatData = { module: string; key: string | null; value: Json };
export type Badges = Record<string, { version: string; text: string }>;
export type ToolUnit = { module: string; tool: Tool };
export const toolId = (module: string) => module.replace(/^[0-9a-f]{8}/, inverted);
