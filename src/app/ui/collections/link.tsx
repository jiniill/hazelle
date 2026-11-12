import { createContext, useContext, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useLayer } from '../overlays/layers';

// A key is `group:id`. A trigger names keys; a mark carries them.
export type LinkState = 'lit' | 'dim' | null;
export type Tipped = { title: string; note: string };

// held: tapped by a finger, so it stays until a press elsewhere, not until the pointer leaves.
type Pointed = { links: readonly string[]; tip?: Tipped; at: Element; held: boolean };

export type Links = {
  active: readonly string[];
  pointed: Pointed | null;
  trigger: (links: readonly string[], tip?: Tipped) => TriggerProps;
};

type TriggerProps = {
  onPointerEnter: (event: PointerEvent<Element>) => void;
  onPointerLeave: (event: PointerEvent<Element>) => void;
  onPointerDown: (event: PointerEvent<Element>) => void;
  onFocus: (event: FocusEvent<Element>) => void;
  onBlur: (event: FocusEvent<Element>) => void;
  onClick: (event: MouseEvent<Element>) => void;
};

const NONE: readonly string[] = [];
const groupOf = (key: string) => key.slice(0, key.indexOf(':'));

// A mark sharing an active key is lit; one of an active key's group sharing none is dimmed; other groups are untouched.
export function linkState(active: readonly string[], keys: readonly string[]): LinkState {
  if (active.length === 0) return null;
  if (keys.some((key) => active.includes(key))) return 'lit';
  return keys.some((key) => active.some((on) => groupOf(on) === groupOf(key))) ? 'dim' : null;
}

// A component's own, for links that stay inside it (a calendar's month names, a split bar's parts).
export function useOwnLinks(): Links {
  const [pointed, point] = useState<Pointed | null>(null);
  const pressedBy = useRef('');
  useLayer(pointed?.held === true, { outside: (target) => !pointed!.at.contains(target), close: () => point(null) });
  const trigger = useMemo(() => {
    const leave = (at: Element) => point((now) => (now?.at === at ? null : now));
    return (links: readonly string[], tip?: Tipped): TriggerProps => ({
      onPointerEnter: (event) => event.pointerType === 'mouse' && point({ links, tip, at: event.currentTarget, held: false }),
      onPointerLeave: (event) => event.pointerType === 'mouse' && leave(event.currentTarget),
      onPointerDown: (event) => void (pressedBy.current = event.pointerType),
      onFocus: (event) => point({ links, tip, at: event.currentTarget, held: false }),
      onBlur: (event) => leave(event.currentTarget),
      // A finger has no hover: its tap holds the trigger, and a second tap lets go. A click's own pointerType is not
      // in every browser yet, so the press before it says.
      onClick: (event) => {
        const by = pressedBy.current;
        pressedBy.current = '';
        if (by !== 'touch' && by !== 'pen') return;
        const at = event.currentTarget;
        point((now) => (now?.at === at && now.held ? null : { links, tip, at, held: true }));
      },
    });
  }, []);
  return { active: pointed?.links ?? NONE, pointed, trigger };
}

const LinkContext = createContext<Links | null>(null);

// One pointer points at one thing: every chart under a scope lights from it, and shows its tip.
export function LinkScope({ children }: { children: ReactNode }) {
  return <LinkContext value={useOwnLinks()}>{children}</LinkContext>;
}

// The scope's, or outside one the component's own, so it still answers its own pointer.
export function useLinks(): Links {
  const own = useOwnLinks();
  return useContext(LinkContext) ?? own;
}
