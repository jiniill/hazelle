import { ArrowDownToLine, BookOpen, Bot, Brain, History, IdCard, Languages, MessageSquare, MessagesSquare, NotebookPen, PenLine, ScrollText, Smile, UserRound, type LucideIcon } from 'lucide-react';
import type { PromptSort, Role, SlotKind } from '../../model/prompt';
import type { OutlineKind } from '../ui';
import { FEATURE_NAMES, ILLUSTRATE_NOTE, inFeature, TOOL, TRANSLATOR_NOTE } from './words';

export const SLOT = {
  tool: { name: TOOL, hint: `${TOOL}이 보탠 내용`, line: `켜 둔 ${TOOL}이 이번 대화에 덧붙인 내용이 들어가요.`, kind: 'note', icon: NotebookPen },
  description: { name: '캐릭터 설명', hint: '카드의 설명 · 성격 · 상황 · 예시 대화', line: '캐릭터 카드의 설명과 성격, 시나리오, 예시 대화가 여기에 들어가요.', kind: 'char', icon: IdCard },
  persona: { name: '페르소나', hint: '이 채팅에서 쓰는 페르소나의 설명', line: '이 채팅에서 쓰는 페르소나 설명이 여기에 들어가요.', kind: 'char', icon: UserRound },
  lorebook: {
    name: '로어북',
    hint: '이번 대화에서 활성화된 로어북 항목',
    line: '이번 대화에서 켜진 로어북 항목이 여기에 들어가요.',
    kind: 'lore',
    icon: BookOpen,
  },
  authorNote: { name: '작가의 노트', hint: '채팅별 노트', line: '채팅마다 적어 둔 작가의 노트가 여기에 들어가요.', kind: 'note', icon: PenLine },
  postEverything: { name: '최종 삽입', hint: '맨 끝에 넣도록 설정한 로어북 항목', line: '로어북에서 맨 끝에 넣도록 정한 항목이 여기에 들어가요.', kind: 'lore', icon: ArrowDownToLine },
  chat: { name: '채팅', hint: '지금까지 주고받은 메시지', line: '지금까지 주고받은 메시지 중 아래에서 정한 범위가 여기에 들어가요.', kind: 'chat', icon: MessageSquare },
  note: {
    name: TRANSLATOR_NOTE,
    hint: '이름과 용어의 번역을 맞추는 메모',
    line: `${inFeature('translate')}의 전역 노트와 캐릭터 편집의 캐릭터 노트가 여기에 들어가요.`,
    kind: 'note',
    icon: NotebookPen,
  },
  illustrateNote: { name: ILLUSTRATE_NOTE, hint: '채팅별 삽화 메모', line: '채팅의 삽화 메뉴에 적어 둔 삽화 노트가 여기에 들어가요.', kind: 'note', icon: PenLine },
  recent: {
    name: '이전 메시지',
    hint: '번역할 메시지 바로 앞의 메시지와 그 번역',
    line: '번역할 메시지 바로 앞의 원문과 번역문이 여기에 들어가요.',
    kind: 'chat',
    icon: MessagesSquare,
  },
  memory: {
    name: FEATURE_NAMES.memory,
    hint: '이 채팅이 기억하는 지난 이야기',
    line: '이 채팅의 장기 기억(상태, 미해결 사건, 기록)이 여기에 들어가요.',
    kind: 'note',
    icon: History,
  },
  span: { name: '정리할 메시지', hint: '기억으로 정리할 메시지', line: '이번에 장기 기억으로 정리할 메시지가 여기에 들어가요.', kind: 'chat', icon: ScrollText },
  source: { name: '원문', hint: '번역할 텍스트', line: '번역할 원문 텍스트가 여기에 들어가요.', kind: 'chat', icon: Languages },
  mascot: { name: FEATURE_NAMES.mascot, hint: '마스코트의 말투와 표정', line: '마스코트의 말투와 표정, 최근 대사, 응답 형식이 여기에 들어가요.', kind: 'char', icon: Smile },
  agentNotes: { name: '에이전트 노트', hint: '전처리 에이전트가 이번 답을 위해 남긴 노트', line: '전처리 에이전트의 노트가 여기에 들어가요.', kind: 'note', icon: Bot },
  agentMemory: { name: '에이전트 기억', hint: '이 에이전트가 채팅마다 이어 적는 기억', line: '이 에이전트의 이전 기억과 기억을 갱신하는 형식이 여기에 들어가요.', kind: 'note', icon: Brain },
} satisfies Record<SlotKind, { name: string; hint: string; line: string; kind: OutlineKind; icon: LucideIcon }>;

export const NO_PERSONA_SLOT = `프롬프트에 '${SLOT.persona.name}' 블록이 없어서 페르소나 설명이 대화에 들어가지 않아요.`;

export const MESSAGE_ROLES: Record<Role, string> = { system: '시스템', user: '사용자', assistant: 'AI' };

export const textName = (role: Role) => `${MESSAGE_ROLES[role]} 메시지`;

export const TASK_NAMES: Record<Exclude<PromptSort, 'conversation'>, string> = { translate: FEATURE_NAMES.translate, memory: '기억', illustrate: FEATURE_NAMES.illustrate, mascot: FEATURE_NAMES.mascot, preread: FEATURE_NAMES.preread, agent: FEATURE_NAMES.agents };
