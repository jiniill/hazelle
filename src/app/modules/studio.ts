import { toolText } from '../../engine/import/tool';
import type { DraftState } from '../../runtime/tools/drafts';
import type { ToolUse } from '../../tool-api/manifest';
import { NETWORK } from '../common/words';

const UNNAMED = '이름 없는 플러그인';

// A draft is named by its own header as typed, before readTool would accept it: a half-written file still has a name.
export function draftHeader(text: string): { title: string; name: string | null; version: string | null } {
  const read = toolText(new TextEncoder().encode(text));
  const value = (key: string) => (read.ok ? read.header.find((line) => line.key === key)?.value || null : null);
  const name = value('name');
  return { title: value('display-name') ?? name ?? UNNAMED, name, version: value('version') };
}

export const DRAFT_STATES: Record<Exclude<DraftState, 'applied'>, string> = { unapplied: '적용 안 함', differs: '적용한 버전과 다름' };

export const USE_TAGS: Record<ToolUse, string> = { model: '모델 호출', embed: '임베딩', memory: '장기 기억', network: NETWORK };
