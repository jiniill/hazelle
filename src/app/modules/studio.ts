import type { ChatScope } from '../../engine/render';
import type { ToolEvent } from '../../engine/script-api';
import type { ToolIdentity } from '../../model/tool';
import { paragraphsOf } from '../../model/illustration';
import { atOf } from '../../runtime/scripts/selection';
import { argsOf } from '../../runtime/models/tool-loop';
import type { DraftState } from '../../runtime/tools/drafts';
import type { ToolManifest, ToolUse } from '../../tool-api/manifest';
import { NETWORK, MODULE_MODELS, FEATURE_NAMES, PLUGIN_DRAWS, ROLE_TAGS, TRIAL } from '../common/words';

export const draftTitle = (identity: ToolIdentity) => identity.displayName || '이름 없는 플러그인';

export const DRAFT_STATES: Record<Exclude<DraftState, 'applied'>, string> = { unapplied: '적용 안 함', differs: '적용한 버전과 다름' };

export const SEE_IN_CODE = '코드에서 보기';
export const USE_TAGS: Record<ToolUse, string> = { model: MODULE_MODELS, embed: ROLE_TAGS.embed, decide: ROLE_TAGS.decide, draw: PLUGIN_DRAWS, memory: FEATURE_NAMES.memory, illustrate: FEATURE_NAMES.illustrate, network: NETWORK };

// What 테스트 can run a draft on: a saved reply, then the turn's stages in their order, a message shown or changed, then
// each item its header declares. text: the event takes the text typed for it. request: it runs on the chat's next
// request (TEST_REQUEST). A branch is not offered: it happens to another chat.
export type TestPick = { value: string; label: string; sub: string; text: boolean };
export const TEST_REQUEST = new Set(['requesting', 'calling']);
export const testPicks = (manifest: ToolManifest): TestPick[] => [
  { value: 'reply', label: '응답을 저장한 뒤', sub: 'reply · 마지막 응답', text: false },
  { value: 'sending', label: '메시지를 보내기 전', sub: 'sending', text: true },
  { value: 'prompt', label: '요청을 만들 때', sub: 'prompt', text: false },
  { value: 'requesting', label: '요청을 보내기 전', sub: 'requesting · 다음 요청', text: false },
  { value: 'calling', label: '봇 스크립트가 모델을 호출할 때', sub: 'calling · 다음 요청을 대신 전달', text: false },
  { value: 'replying', label: '응답을 저장하기 전', sub: 'replying · 마지막 응답', text: false },
  { value: 'showing', label: '메시지를 표시할 때', sub: 'showing · 마지막 메시지', text: false },
  { value: 'change', label: '메시지를 수정한 뒤', sub: 'change · 마지막 메시지', text: false },
  ...(manifest.uses.includes('illustrate') ? [{ value: 'illustrate', label: '삽화를 만들 때', sub: 'illustrate · 마지막 응답', text: false }] : []),
  ...manifest.menu.map(({ id, label }) => ({ value: `menu:${id}`, label: `⋯ 메뉴 · ${label}`, sub: 'menu', text: false })),
  ...(manifest.actions ?? []).map(({ id, label }) => ({ value: `action:${id}`, label: `메시지 버튼 · ${label}`, sub: 'action · 마지막 메시지', text: false })),
  ...(manifest.inputs ?? []).map(({ id, label }) => ({ value: `input:${id}`, label: `입력창 버튼 · ${label}`, sub: 'input', text: true })),
  ...(manifest.functions ?? []).map(({ name }) => ({ value: `tool:${name}`, label: `모델 도구 · ${name}`, sub: 'tool', text: true })),
];

// The event a pick runs on the chat as it stands; null when the chat holds no message it needs, a tool's arguments are
// not a JSON object, or a TEST_REQUEST pick is given no request. No arguments typed is a call with none.
export function testEvent(pick: string, scope: ChatScope, text: string, manifest: ToolManifest, request: Hazelle.RequestMessage[] | null = null): ToolEvent | null {
  const told = scope.messages.slice(scope.greeting === null ? 0 : 1);
  const at = (message: { message: string } | undefined) => message ? atOf(scope, message.message) : null;
  const reply = told.findLast((message) => message.role === 'assistant');
  const [kind, item = ''] = pick.split(/:(.*)/s);
  switch (kind) {
    case 'reply': { const saved = at(reply); return saved && { kind: 'reply', reply: saved }; }
    case 'sending': return { kind: 'sending', text };
    case 'prompt': return { kind: 'prompt', turn: { memory: manifest.uses.includes('memory') } };
    case 'requesting': return request && { kind: 'requesting', messages: request };
    case 'calling': return request && { kind: 'calling', role: 'main', messages: request.map(({ role, content }) => ({ role, content })) };
    case 'replying': return reply ? { kind: 'replying', text: reply.text } : null;
    case 'showing': { const last = scope.messages.at(-1); return last ? { kind: 'showing', shown: [{ at: told.length ? at(last) : null, text: last.text }] } : null; }
    case 'change': { const changed = at(told.at(-1)); return changed && { kind: 'change', change: { ...changed, kind: 'edit' } }; }
    // As a press asks: one picture, the count a reply of any length is given at the least.
    case 'illustrate': { const message = at(reply); return message && { kind: 'illustrate', ask: { message, paragraphs: paragraphsOf(reply!.text), count: 1, auto: false } }; }
    case 'menu': return { kind: 'menu', item };
    case 'action': { const message = at(told.at(-1)); return message && { kind: 'action', item, message }; }
    case 'tool': { const args = argsOf(text.trim() || '{}'); return args && { kind: 'tool', name: item, args }; }
    default: return { kind: 'input', item, text };
  }
}

// AI로 수정's ask, shown as sent: the run's error, its moment and its line. line counts in body, as the model is sent it.
export function fixAsk(failed: string, moment: string, body: string, line: number | null): string {
  const text = line === null ? undefined : body.split('\n')[line - 1];
  return ['테스트에서 난 오류를 수정해 주세요.', `${TRIAL.when}: ${moment}`, `오류: ${failed}`, ...(text === undefined ? [] : [`${line}번째 줄: ${text.trim()}`])].join('\n');
}

// Where line (counted from 1) stands in text, as a selection; [0, 0] for a line it does not hold.
export function lineRange(text: string, line: number): [number, number] {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return [0, 0];
  const from = lines.slice(0, line - 1).reduce((sum, each) => sum + each.length + 1, 0);
  return [from, from + lines[line - 1]!.length];
}
