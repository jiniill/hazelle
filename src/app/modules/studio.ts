import type { ChatScope } from '../../engine/render';
import type { ToolEvent } from '../../engine/script-api';
import type { ToolIdentity } from '../../model/tool';
import { atOf } from '../../runtime/script-selection';
import { argsOf } from '../../runtime/tool-loop';
import type { DraftState } from '../../runtime/tools/drafts';
import type { ToolManifest, ToolUse } from '../../tool-api/manifest';
import { NETWORK } from '../common/words';

export const draftTitle = (identity: ToolIdentity) => identity.displayName || '이름 없는 플러그인';

export const DRAFT_STATES: Record<Exclude<DraftState, 'applied'>, string> = { unapplied: '적용 안 함', differs: '적용한 버전과 다름' };

export const USE_TAGS: Record<ToolUse, string> = { model: '모델 호출', embed: '임베딩', memory: '장기 기억', network: NETWORK };

// What 테스트 can run a draft on: the turn's stages, then each item its header declares. text: the event takes the text
// typed for it.
export type TestPick = { value: string; label: string; sub: string; text: boolean };
export const testPicks = (manifest: ToolManifest): TestPick[] => [
  { value: 'reply', label: '응답이 저장된 뒤', sub: 'reply · 마지막 응답', text: false },
  { value: 'sending', label: '메시지를 보내기 전', sub: 'sending', text: true },
  { value: 'prompt', label: '요청을 만들 때', sub: 'prompt', text: false },
  ...manifest.menu.map(({ id, label }) => ({ value: `menu:${id}`, label: `⋯ 메뉴 · ${label}`, sub: 'menu', text: false })),
  ...(manifest.actions ?? []).map(({ id, label }) => ({ value: `action:${id}`, label: `메시지 버튼 · ${label}`, sub: 'action · 마지막 메시지', text: false })),
  ...(manifest.inputs ?? []).map(({ id, label }) => ({ value: `input:${id}`, label: `입력창 버튼 · ${label}`, sub: 'input', text: true })),
  ...(manifest.functions ?? []).map(({ name }) => ({ value: `tool:${name}`, label: `모델 도구 · ${name}`, sub: 'tool', text: true })),
];

// The event a pick runs on the chat as it stands; null when the chat holds no message it needs, or a tool's arguments
// are not a JSON object. No arguments typed is a call with none.
export function testEvent(pick: string, scope: ChatScope, text: string, manifest: ToolManifest): ToolEvent | null {
  const told = scope.messages.slice(scope.greeting === null ? 0 : 1);
  const at = (message: { message: string } | undefined) => message ? atOf(scope, message.message) : null;
  const [kind, item = ''] = pick.split(/:(.*)/s);
  switch (kind) {
    case 'reply': { const reply = at(told.findLast((message) => message.role === 'assistant')); return reply && { kind: 'reply', reply }; }
    case 'sending': return { kind: 'sending', text };
    case 'prompt': return { kind: 'prompt', turn: { memory: manifest.uses.includes('memory') } };
    case 'menu': return { kind: 'menu', item };
    case 'action': { const message = at(told.at(-1)); return message && { kind: 'action', item, message }; }
    case 'tool': { const args = argsOf(text.trim() || '{}'); return args && { kind: 'tool', name: item, args }; }
    default: return { kind: 'input', item, text };
  }
}

// AI로 수정's ask, shown as sent: the run's error, its moment and its line. line counts in body, as the model is sent it.
export function fixAsk(failed: string, moment: string, body: string, line: number | null): string {
  const text = line === null ? undefined : body.split('\n')[line - 1];
  return ['테스트에서 난 오류를 수정해 주세요.', `실행 시점: ${moment}`, `오류: ${failed}`, ...(text === undefined ? [] : [`${line}번째 줄: ${text.trim()}`])].join('\n');
}
