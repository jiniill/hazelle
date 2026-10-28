import { Sparkle, Text, User, type LucideIcon } from 'lucide-react';
import { autoCachePoints } from '../../engine/cache-points';
import type { Block, ChatRange, Role, TextBlock } from '../../model/prompt';
import { MESSAGE_ROLES, SLOT, textName } from '../common/prompt-words';
import { count } from '../common/typedNumber';
import type { OutlineKind } from '../ui';
import { toggleUses } from './rekey';

export const ROLES: { value: Role; label: string }[] = (['system', 'user', 'assistant'] as const).map((value) => ({ value, label: MESSAGE_ROLES[value] }));

export const TEXTS: { role: Role; name: string; hint: string }[] = [
  { role: 'system', name: textName('system'), hint: '규칙과 지시문을 적어요' },
  { role: 'user', name: textName('user'), hint: '내가 보낸 메시지처럼 들어가요' },
  { role: 'assistant', name: textName('assistant'), hint: '모델 응답의 시작 부분을 미리 지정할 때 써요' },
];

export const MARKS = {
  main: { label: '본문', hint: `카드의 '시스템 프롬프트'로 대체돼요`, card: '시스템 프롬프트' },
  globalNote: { label: '글로벌 노트', hint: `카드의 '대화 뒤 지시문'으로 대체돼요`, card: '대화 뒤 지시문' },
} as const;

const TEXT_ICONS: Record<Role, LucideIcon> = { system: Text, user: User, assistant: Sparkle };

// The ranges the 채팅 pane offers; an imported range outside them keeps its own line.
export const RANGES: { range: ChatRange; label: string; meta: string }[] = [
  { range: { from: 0, to: null }, label: '처음부터 끝까지', meta: '전체' },
  { range: { from: 0, to: -1 }, label: '처음부터 마지막 하나 전까지', meta: '마지막 1개 제외' },
  { range: { from: -1, to: null }, label: '마지막 하나', meta: '마지막 1개' },
  { range: { from: 0, to: -2 }, label: '처음부터 마지막 둘 전까지', meta: '마지막 2개 제외' },
  { range: { from: -2, to: null }, label: '마지막 둘', meta: '마지막 2개' },
];
export const rangeKey = ({ from, to }: ChatRange) => `${from}:${to ?? 'end'}`;

export function describeRange(range: ChatRange): { label: string; meta: string } {
  const known = RANGES.find((option) => rangeKey(option.range) === rangeKey(range));
  if (known) return known;
  const { from, to } = range;
  const start = from === 0 ? '처음부터' : from > 0 ? `앞의 ${from}개 다음부터` : `끝에서 ${-from}번째부터`;
  const end = to === null ? '끝까지' : to < 0 ? `마지막 ${-to}개 전까지` : `${to}번째까지`;
  return { label: `${start} ${end}`, meta: '사용자 지정 범위' };
}

export const firstLine = (text: string) => text.trim().split('\n')[0]!.trim();

export function blockTitle(block: Block): { title: string; dim: boolean } {
  if (block.name) return { title: block.name, dim: false };
  if (block.kind === 'slot') return { title: SLOT[block.slot].name, dim: false };
  return { title: firstLine(block.text) || `빈 ${TEXTS.find((text) => text.role === block.role)!.name}`, dim: true };
}

export const blockKind = (block: Block): OutlineKind => (block.kind === 'text' ? 'text' : SLOT[block.slot].kind);
export const blockIcon = (block: Block): LucideIcon => (block.kind === 'text' ? TEXT_ICONS[block.role] : SLOT[block.slot].icon);

export function blockMeta(block: Block): string {
  if (block.kind === 'text') return block.text ? `${count(block.text.length)}자` : '비어 있음';
  if (block.slot === 'chat') return describeRange(block.range).meta;
  if (block.slot === 'recent') return `${block.count}개${block.translations === false ? ' · 원문만' : ''} · ${MESSAGE_ROLES[block.role]}`;
  return 'role' in block ? MESSAGE_ROLES[block.role] : '';
}

export const blockSource = (block: Block): string => (block.kind === 'text' ? block.text : 'wrapper' in block ? (block.wrapper ?? '') : '');

export const hasConditions = (block: Block) => toggleUses(blockSource(block)).length > 0;

export const isText = (block: Block): block is TextBlock => block.kind === 'text';

export type CacheMark = 'set' | 'auto';

// The cache point after each block: its own, or one the engine sets itself.
export function cacheMarks(blocks: readonly Block[]): Map<string, CacheMark> {
  const auto = autoCachePoints(blocks.map((block) => (block.kind === 'slot' && (block.slot === 'chat' || block.slot === 'memory') ? block.slot : null))).map((index) => blocks[index]!.id);
  const marks = new Map<string, CacheMark>();
  for (const block of blocks) {
    if (block.cache) marks.set(block.id, 'set');
    else if (auto.includes(block.id)) marks.set(block.id, 'auto');
  }
  return marks;
}
