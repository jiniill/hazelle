import type { LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, SelectionBar, useFocusReturn } from '../ui';

// counted: a count of picked things as the screen says it (3개, 캐릭터 3명). ask: the bar's words while none is picked.
// every: the ids 모두 선택 picks, where the screen offers it. why: after those words, why an act on the bar is disabled.
type Bar = { counted: (count: number) => string; ask: string; every?: readonly string[]; why?: string };

// Picking several things on a screen: null while not picking. A plain press on a thing toggles it only while picking;
// toggle and range start a pick (Ctrl and Shift).
export function useSelection() {
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  // Where a Shift range starts: the thing last toggled, kept across ranges as a file list keeps it.
  const anchor = useRef<string | null>(null);
  // The bar's 취소 or a move takes the focus with the bar; it goes back to the button that started the pick.
  const starter = useRef<HTMLButtonElement>(null);
  useFocusReturn(picked !== null, () => starter.current);
  const start = () => setPicked(new Set());
  const clear = () => {
    anchor.current = null;
    setPicked(null);
  };
  const all = (ids: readonly string[]) => setPicked(new Set(ids));
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    anchor.current = id;
    setPicked(next);
  };
  // order: the things as the screen lists them now.
  const range = (id: string, order: readonly string[]) => {
    const from = order.indexOf(anchor.current ?? id);
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return toggle(id);
    setPicked(new Set([...(picked ?? []), ...order.slice(Math.min(from, to), Math.max(from, to) + 1)]));
  };
  return {
    picked,
    start,
    clear,
    all,
    toggle,
    range,
    // The head's button that starts picking, and ends it as 완료; compact, an icon pressed while picking, for a narrow head.
    button: (icon: LucideIcon, label: string, compact = false) =>
      compact ? (
        <IconButton ref={starter} icon={icon} label={label} size="sm" pressed={picked !== null} onClick={picked ? clear : start} />
      ) : (
        <Button ref={starter} variant="secondary" size="sm" icon={icon} onClick={picked ? clear : start}>
          {picked ? '완료' : label}
        </Button>
      ),
    // actions: what is done to the pick, after 취소.
    bar: ({ counted, ask, every, why }: Bar, actions: ReactNode) =>
      picked && (
        <SelectionBar>
          <span>{[picked.size ? `${counted(picked.size)} 선택됨` : ask, why].filter(Boolean).join(' · ')}</span>
          {every && (
            <Button variant="secondary" size="sm" onClick={() => all(every)}>
              모두 선택
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={clear}>
            취소
          </Button>
          {actions}
        </SelectionBar>
      ),
  };
}
