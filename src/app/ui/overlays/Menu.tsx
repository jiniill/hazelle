import { ChevronLeft, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChangeSignal } from '../../../change-signal';
import { Item } from '../collections/Item';
import { ButtonSlot } from '../controls/Button';
import { CheckMark, Icon } from '../foundation/Icon';
import { faceStyle, type FontId } from '../foundation/fonts';
import { hasFinePointer } from '../foundation/media';
import { keepOnScreen, menuEdge, openingField, room, useLayer } from './layers';
import styles from './Menu.module.css';

export type MenuOpener = { ref: RefObject<HTMLButtonElement | null>; popup: 'menu' | 'dialog'; expanded: boolean; onClick: () => void };

// at: where a right-click opened it (MoreMenu's slot), instead of beside its button.
type State = { open: boolean; from: HTMLElement | null; at?: { x: number; y: number } };
const CLOSED: State = { open: false, from: null };

export type MenuHandle = { read: () => State; subscribe: (listener: () => void) => () => void; set: (state: State) => void };

function menuHandle(): MenuHandle {
  let state = CLOSED;
  const changes = new ChangeSignal();
  return {
    read: () => state,
    subscribe: changes.subscribe,
    set: (next) => {
      state = next;
      changes.notify();
    },
  };
}

export function useMenuHandle() {
  return useState(menuHandle)[0];
}

export function useMenuOpener(handle: MenuHandle): MenuOpener {
  const ref = useRef<HTMLButtonElement>(null);
  const { open } = useSyncExternalStore(handle.subscribe, handle.read);
  return { ref, popup: 'menu', expanded: open, onClick: () => handle.set(handle.read().open ? CLOSED : { open: true, from: ref.current }) };
}

type Props = {
  label: string;
  trigger: (opener: MenuOpener) => ReactNode;
  // Choose the opposite half of the clipping scroller; fixed direction can squeeze menus under headers/composers.
  place?: 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'start' | 'end';
  size?: 'md' | 'lg' | 'form';
  // dialog: a small form opened and closed like a menu, such as the chat's 작가의 노트; useMenuClose closes it.
  kind?: 'menu' | 'dialog';
  handle?: MenuHandle;
  children: ReactNode;
};

const CloseMenu = createContext(() => {});

// Only one menu branch stays open: preserve ancestors, close unrelated menus.
// Keyboard can reach another trigger while the current menu is open.
let shown: (() => void)[] = [];
const Holders = createContext<readonly (() => void)[]>([]);

export function Menu({ label, trigger, place = 'below-start', size = 'md', kind = 'menu', handle, children }: Props) {
  const own = useMenuHandle();
  const menu = handle ?? own;
  const { open, from, at } = useSyncExternalStore(menu.subscribe, menu.read);
  const opener = useMenuOpener(menu);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    menu.set(CLOSED);
    if (refocus) (from?.isConnected ? from : opener.ref.current)?.focus();
  };
  // A press on the button that opened it is not outside, so that button closes it again like the menu's own does.
  useLayer(open, { outside: (target) => !anchor.current?.contains(target) && !panel.current?.contains(target) && !from?.contains(target), close, takesBack: true });

  // A menu that is not on the page is closed, so no button elsewhere shows it open.
  useEffect(() => () => menu.set(CLOSED), [menu]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(`${openingField(hasFinePointer())}, [role^="menuitem"], button`)?.focus();
  }, [open]);

  const holders = useContext(Holders);
  const hide = useMemo(() => () => menu.set(CLOSED), [menu]);
  const held = useMemo(() => [...holders, hide], [holders, hide]);
  // Before paint, so two menus are never drawn at once.
  useLayoutEffect(() => {
    if (!open) return;
    for (const other of shown.filter((each) => !holders.includes(each))) other();
    shown = [...shown, hide];
    return () => {
      shown = shown.filter((each) => each !== hide);
    };
  }, [open, holders, hide]);

  const [upward, setUpward] = useState(false);
  const flips = place === 'start' || place === 'end';
  useLayoutEffect(() => {
    if (open && flips) {
      const { top, bottom } = anchor.current!.getBoundingClientRect();
      const box = room(anchor.current!);
      setUpward(top + bottom > box.top + box.bottom);
    }
  }, [open, flips]);
  const side = flips ? (`${upward ? 'above' : 'below'}-${place}` as const) : place;

  // A menu taller than the room on its side scrolls within that room instead of running off the screen.
  useLayoutEffect(() => {
    if (!panel.current) return;
    if (at) {
      placeAt(panel.current, at);
      keepOnScreen(panel.current);
      return;
    }
    keepOnScreen(panel.current);
    const box = panel.current.getBoundingClientRect();
    const edge = menuEdge(panel.current);
    const { top, bottom } = room(panel.current);
    panel.current.style.setProperty('--room', `${side.startsWith('above') ? box.bottom - top - edge : bottom - box.top - edge}px`);
  }, [open, side, at]);

  // At the pointer it stands on the screen, not in its anchor's column: a list narrower than the menu would clip it.
  const body = (
    <div
      ref={panel}
      className={`${styles.menu} ${at ? styles.point : styles[side]} ${styles[size]} ${kind === 'dialog' ? styles.dialog : ''}`}
      role={kind}
      aria-label={label}
      onKeyDown={kind === 'menu' ? (event) => moveByKey(panel.current!, event) : undefined}
    >
      <Holders.Provider value={held}>
        <CloseMenu.Provider value={() => close(true)}>
          <ButtonSlot value={null}>{children}</ButtonSlot>
        </CloseMenu.Provider>
      </Holders.Provider>
    </div>
  );
  return (
    <div className={styles.anchor} ref={anchor}>
      {trigger({ ...opener, popup: kind })}
      {open && (at ? createPortal(body, document.body) : body)}
    </div>
  );
}

// ↑ ↓ step through this menu's own items, round its ends, and Home End go to them; a menu inside it steps its own
// first. A field in it keeps these keys for its caret.
export function moveByKey(panel: HTMLElement, event: KeyboardEvent) {
  if (event.defaultPrevented || (event.target as Element).matches('input, textarea')) return;
  const items = [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')].filter((item) => item.closest('[role="menu"]') === panel);
  // -1 while the focus is on none of them, such as on MenuBack.
  const at = items.indexOf(document.activeElement as HTMLElement);
  const count = items.length;
  const next = count === 0 ? undefined : ({ Home: 0, End: count - 1, ArrowDown: (at + 1) % count, ArrowUp: (at <= 0 ? count : at) - 1 } as Record<string, number>)[event.key];
  if (next === undefined) return;
  event.preventDefault();
  items[next]!.focus();
}

// Drops from the pointer, or rises to it where the room below is shorter than the menu and than the room above.
function placeAt(panel: HTMLElement, at: { x: number; y: number }) {
  const edge = menuEdge(panel);
  const { top, bottom } = room(panel);
  const below = bottom - edge - at.y;
  const above = at.y - top - edge;
  const upward = panel.offsetHeight > below && above > below;
  panel.style.setProperty('--room', `${upward ? above : below}px`);
  panel.style.setProperty('--point-left', `${at.x}px`);
  panel.style.setProperty('--point-top', `${upward ? at.y - panel.offsetHeight : at.y}px`);
}

type ItemProps = {
  label: string;
  sub?: string;
  // face: the label drawn in that font.
  face?: FontId;
  icon?: LucideIcon;
  avatar?: ReactNode;
  tag?: ReactNode;
  checked?: boolean;
  multiple?: boolean;
  tone?: 'plain' | 'muted' | 'warn';
  disabled?: boolean;
  onClick: () => void;
};

// The menu closes before onClick runs, so a dialog it opens takes the button that opened the menu as the place to
// give the focus back to.
export function MenuItem({ label, sub, face, icon, avatar, tag, checked, multiple, tone, disabled, onClick }: ItemProps) {
  const close = useContext(CloseMenu);
  return (
    <Item
      density="compact"
      scheme="list"
      role={checked === undefined ? 'menuitem' : multiple ? 'menuitemcheckbox' : 'menuitemradio'}
      checked={checked}
      tone={tone}
      disabled={disabled}
      leading={avatar ?? (icon && <Icon icon={icon} size="sm" />)}
      title={face === undefined ? label : <span className={styles.face} style={faceStyle(face)}>{label}</span>}
      meta={tag}
      preview={sub}
      trailing={checked && <CheckMark />}
      onClick={() => {
        close();
        onClick();
      }}
    />
  );
}

export const useMenuClose = () => useContext(CloseMenu);

// Above a form that replaced the panel's list: quieter than the form's own title, and on its line. It takes the focus,
// the button that opened the form being gone.
export function MenuBack({ label, onClick }: { label: string; onClick: () => void }) {
  const self = useRef<HTMLButtonElement>(null);
  useEffect(() => self.current?.focus(), []);
  return (
    <button ref={self} type="button" className={styles.back} onClick={onClick}>
      <Icon icon={ChevronLeft} size="sm" />
      {label}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <span className={styles.heading}>{children}</span>;
}
