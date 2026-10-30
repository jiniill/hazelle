import { useEffect, useRef } from 'react';
import { UNDO } from './common/words';
import { formatKeys, pressed, type Chord } from './ui';

type Shortcut = { label: string; keys: readonly Chord[] };

// A modifier a chord leaves out is not checked, so Ctrl+Enter still sends and Ctrl+Shift+Enter still saves an edit.
export const SHORTCUTS = {
  // Its handler must never pass Ctrl+S on, or the browser's save-page dialog opens.
  settings: { label: '설정 열기 · 닫기', keys: [{ key: ',', mod: true }, { key: 's', mod: true }] },
  personas: { label: '페르소나 (채팅에서는 바꾸기)', keys: [{ key: 'e', mod: true }] },
  prompts: { label: '프롬프트 (채팅에서는 바꾸기)', keys: [{ key: 'p', mod: true }] },
  shortcutList: { label: '단축키 보기', keys: [{ key: '/', mod: true }] },
  sidebar: { label: '사이드바 접기 · 펼치기', keys: [{ key: 'b', mod: true }] },
  status: { label: '상태 보기 · 닫기 (상태창을 지정한 채팅)', keys: [{ key: '.', mod: true }] },
  pictures: { label: '이미지 가리기 · 보이기', keys: [{ key: 'h', mod: true, shift: true }] },
  send: { label: '보내기', keys: [{ key: 'Enter', shift: false }] },
  newline: { label: '줄바꿈', keys: [{ key: 'Enter', shift: true }] },
  stop: { label: '응답 생성 중지', keys: [{ key: 'Escape' }] },
  editLast: { label: '내 마지막 메시지 수정', keys: [{ key: 'ArrowUp' }] },
  swipe: { label: '응답 넘기기 · 마지막에서 다시 생성', keys: [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }] },
  storyStep: { label: '메시지 단위로 상하 이동', keys: [{ key: 'ArrowUp', alt: true }, { key: 'ArrowDown', alt: true }] },
  storyEnds: { label: '채팅 맨 위 · 맨 아래로 이동', keys: [{ key: 'Home' }, { key: 'End' }] },
  saveEdit: { label: '수정 저장', keys: [{ key: 'Enter', mod: true }] },
  translate: { label: '번역하기', keys: [{ key: 'Enter', mod: true }] },
  cancelEdit: { label: '수정 취소', keys: [{ key: 'Escape' }] },
  // Its handler stays mounted only with a chat open and passes a key aimed at a side panel, so elsewhere the key is the
  // browser's find.
  find: { label: '채팅 내 검색', keys: [{ key: 'f', mod: true }] },
  // Risu's own key for its prompt preview, kept for the hands that move from it.
  inspect: { label: '점검 열기 · 닫기', keys: [{ key: 'u', mod: true }] },
  findNext: { label: '다음 결과', keys: [{ key: 'Enter', shift: false }] },
  findPrevious: { label: '이전 결과', keys: [{ key: 'Enter', shift: true }] },
  closeFind: { label: '검색 닫기', keys: [{ key: 'Escape' }] },
  undoToast: { label: `알림에서 ${UNDO}`, keys: [{ key: 'z', mod: true, shift: false }] },
  undo: { label: UNDO, keys: [{ key: 'z', mod: true, shift: false }] },
  redo: { label: '다시 실행', keys: [{ key: 'z', mod: true, shift: true }, { key: 'y', mod: true }] },
  // Not Risu's Ctrl+X: in a text field that is cut. Shift held, no other chord here matches it.
  bigEdit: { label: '크게 편집 열기 · 닫기', keys: [{ key: 'x', mod: true, shift: true }] },
} as const satisfies Record<string, Shortcut>;

type Name = keyof typeof SHORTCUTS;

// Enter로 보내기 off (설정 › 조작): Enter only breaks the line, and Ctrl+Enter sends.
const ENTER_OFF: Partial<Record<Name, readonly Chord[]>> = { send: [{ key: 'Enter', mod: true }], newline: [{ key: 'Enter' }] };
export const keysOf = (name: Name, enterSends: boolean) => (enterSends ? undefined : ENTER_OFF[name]) ?? SHORTCUTS[name].keys;

// Where each shortcut works, in the order 단축키 lists them.
export const SHORTCUT_GROUPS: readonly { title: string; note?: string; names: readonly Name[] }[] = [
  { title: '공통', names: ['settings', 'personas', 'prompts', 'shortcutList', 'sidebar', 'status', 'pictures', 'undoToast'] },
  { title: '채팅', note: '화살표 키와 Home · End는 입력창이 비어 있을 때만 작동해요. 사이드 패널에서 Ctrl+F를 누르면 브라우저 검색이 열려요.', names: ['send', 'newline', 'stop', 'editLast', 'swipe', 'storyStep', 'storyEnds', 'saveEdit', 'cancelEdit', 'find', 'inspect'] },
  { title: '채팅 검색창', names: ['findNext', 'findPrevious', 'closeFind'] },
  { title: '번역기', note: '원문 칸에서 작동해요.', names: ['translate'] },
  { title: '프롬프트 편집', note: '블록과 토글 변경을 되돌리고, 텍스트 칸 안에서는 입력한 내용을 되돌려요.', names: ['undo', 'redo'] },
  { title: '긴 텍스트 칸', note: '로어북 항목 내용, 프롬프트 블록의 텍스트 칸, 트리거 코드 칸에서 작동해요.', names: ['bigEdit'] },
];

const TEXT_INPUTS = new Set(['text', 'search', 'password']);
// Ctrl+Z in a text field is the browser's own undo of what was typed there, which no shortcut takes.
export function typing(event?: KeyboardEvent): boolean {
  const target = event?.target;
  return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)) || (target instanceof HTMLElement && target.isContentEditable);
}

// false passes the key on, to the handler mounted before this one and then to the browser. Without an event it
// was run from a button or menu.
type Handler = (event?: KeyboardEvent) => boolean | void;

// Newest last; the one window listener serves them all. fallback marks the shell's own answer, which every screen's
// handler for the same keys comes before: mount order cannot decide that, since React runs a child's effects first.
type Entry = { name: Name; run: Handler; fallback: boolean };
const handlers: Entry[] = [];

const inTurn = () => [...handlers.filter((entry) => !entry.fallback).reverse(), ...handlers.filter((entry) => entry.fallback).reverse()];

function onKey(event: KeyboardEvent) {
  // A key a focused control already took, such as Ctrl+Enter saving an edit, is not a shortcut.
  if (event.defaultPrevented) return;
  const press = { key: event.key, code: event.code, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, nativeEvent: event };
  for (const { name, run } of inTurn()) {
    if (!pressed(press, SHORTCUTS[name].keys) || run(event) === false) continue;
    event.preventDefault();
    return;
  }
}

export function useShortcut(name: Name, handler: Handler, { fallback = false } = {}) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const entry = { name, run: (event?: KeyboardEvent) => latest.current(event), fallback };
    if (handlers.length === 0) window.addEventListener('keydown', onKey);
    handlers.push(entry);
    return () => {
      handlers.splice(handlers.indexOf(entry), 1);
      if (handlers.length === 0) window.removeEventListener('keydown', onKey);
    };
  }, [name, fallback]);
}

export function runShortcut(name: Name) {
  for (const entry of inTurn()) if (entry.name === name && entry.run() !== false) return;
}

export const titled = (label: string, keys: readonly Chord[]) => `${label} · ${formatKeys(keys)}`;
