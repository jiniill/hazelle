import { CopyPlus, Copy, Download, Flag, MessageSquarePlus, Pencil, Plus, RefreshCw, RotateCcw, RotateCw, Save, Star, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { EXPORT } from './words';

// Keep action icons synchronized across screens (lint-enforced). Retry, regenerate and restore are distinct acts.
// Import means into the app, export to device; lucide Import visually conflicts with Download.
type Act = { label: string; icon: LucideIcon };

export const ACTS = {
  create: { label: '추가', icon: Plus },
  import: { label: '가져오기', icon: Upload },
  export: { label: EXPORT, icon: Download },
  remove: { label: '삭제', icon: Trash2 },
  duplicate: { label: '사본 만들기', icon: CopyPlus },
  copy: { label: '복사', icon: Copy },
  rename: { label: '이름 바꾸기', icon: Pencil },
  // A saved preset takes the values in use now.
  overwrite: { label: '현재 설정으로 덮어쓰기', icon: Save },
  retry: { label: '다시 시도', icon: RotateCw },
  regenerate: { label: '다시 생성', icon: RefreshCw },
  restore: { label: '복원', icon: RotateCcw },
  newChat: { label: '새 채팅', icon: MessageSquarePlus },
  report: { label: '신고', icon: Flag },
  // A chat marked to be found again; a message's mark is 북마크, a record's or a toggle's 고정.
  star: { label: '즐겨찾기', icon: Star },
} satisfies Record<string, Act>;

// 새 X makes a thing of its own; X 추가 puts an entry into the list that owns it.
export const newOf = (noun: string) => `새 ${noun}`;
export const addOf = (noun: string) => `${noun} ${ACTS.create.label}`;
export const importOf = (noun: string) => `${noun} ${ACTS.import.label}`;
export const exportOf = (noun: string) => `${noun} ${ACTS.export.label}`;
