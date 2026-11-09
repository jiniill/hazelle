import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { HOSTED } from '../../contracts/installation';
import { selfHost } from '../../runtime/installation';
import { addressOf, layered, onBoard, parseAddress, type Address, type Back, type Route } from './routes';

const NAVIGATED = 'risu-alpha:navigate';

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATED, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATED, listener);
  };
}

const address = () => location.pathname + location.search + location.hash;

// The page held behind a layer's window keeps reading the route it was opened on.
export const HeldRoute = createContext<Route | null>(null);

export function useAddress(): Address {
  const at = useSyncExternalStore(subscribe, address);
  return useMemo(() => parseAddress(at), [at]);
}

export function useRoute(): Route {
  const held = useContext(HeldRoute);
  const { route } = useAddress();
  return held ?? route;
}

// An open overlay holds one same-URL entry of its own, so a back that closes the newest writes no history. An entry's
// state counts the guards up to it, which is how a reload still knows what it stands on. It also counts the layer
// entries walked since the page under the layer (depth, which a guard copies): closing goes back that far, so the
// layer leaves no history. Depth 0 on a layer: no entry of the page under it, after a reload or a link from outside.
type BackLayers = { count: () => number; closeAbove: (keep: number) => void; subscribe: (listener: () => void) => () => void };
let overlays: BackLayers | null = null;
let listening = false;
// history.go lands later, and a history write before it lands puts the entry in the wrong place.
let traveling = false;
let afterTravel: (() => void) | null = null;

// from: the address of the entry under this one, as this router wrote it.
type Entry = { guards?: number; depth?: number; from?: string };
const entry = () => (history.state as Entry | null) ?? {};
const guards = () => (overlays && entry().guards) || 0;
const depth = () => entry().depth ?? 0;

function travel(by: number) {
  traveling = true;
  history.go(by);
}

function settle() {
  if (!overlays || traveling) return;
  const want = overlays.count();
  let have = guards();
  if (have > want) return travel(want - have);
  // No URL: a same-URL entry that keeps whatever the address holds. Never through navigate, which resets the scroll.
  while (have < want) history.pushState({ ...entry(), guards: ++have }, '');
}

function landed() {
  if (traveling) {
    traveling = false;
    const next = afterTravel;
    afterTravel = null;
    next?.();
    settle();
  } else if (overlays) {
    const have = guards();
    if (have < overlays.count()) overlays.closeAbove(have);
    // Forward onto a guard already given up, or a reload's.
    else settle();
  }
}

export function holdBack(layers: BackLayers) {
  overlays = layers;
  if (!listening) window.addEventListener('popstate', landed);
  listening = true;
  // A microtask, so one menu replacing another in a commit nets out to no history at all.
  const stop = layers.subscribe(() => queueMicrotask(settle));
  settle();
  return () => {
    stop();
    overlays = null;
  };
}

const target = (route: Route, now: Address) => addressOf({ route, under: layered(route) ? (now.under ?? now.route) : null });

// replace: write over the entry standing, as 설정's sidebar does walking between its pages.
export function navigate(route: Route, { replace = false } = {}) {
  const now = parseAddress(address());
  const over = layered(route);
  const at = target(route, now);
  // A self-host's 게시판 is hazelle.app's, where release news and questions meet, so every way into it opens there.
  if (selfHost() && onBoard(route)) return void window.open(HOSTED + at, '_blank', 'noopener');
  if (at === addressOf(now)) return;
  // Leaving a layer goes back to the page under it first, then on from there; with no entry of it, over the layer's.
  if (!over && now.under !== null) {
    if (traveling || depth() > 0) {
      afterTravel = () => navigate(route, { replace });
      if (!traveling) travel(-(guards() + depth()));
      return;
    }
    replace = true;
  }
  // The menu an item closes is still counted here, since its layer leaves in an effect after this call. Its guard
  // becomes the new route's entry, so one back returns from the route; a replace must take the entry under the guards.
  const have = guards();
  const keep = replace ? 0 : 1;
  if (traveling || have > keep) {
    afterTravel = () => navigate(route, { replace });
    if (!traveling) travel(keep - have);
    return;
  }
  // A guard replaced counts as pushed: it stood above the entry.
  const walked = over ? (now.under === null ? Number(!replace) : !replace && depth() > 0 ? depth() + 1 : depth()) : 0;
  const from = replace ? entry().from : addressOf(now);
  history[replace || have > 0 ? 'replaceState' : 'pushState']({ from, ...(walked ? { depth: walked } : {}) }, '', at);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(NAVIGATED));
  // An overlay that stays across the route (단축키 over a keyboard shortcut) has just lost its guard, with no layer change to say so.
  queueMicrotask(settle);
}

// What an editor opens from its own list: beside the list it takes the entry's place, as 설정's sidebar does; drilled
// into on a phone it is a step of its own, which back takes back.
export const openPart = (route: Route, beside: boolean) => navigate(route, { replace: beside });

// 설정 or 도구's ×, Esc and shortcut: back to the page under it.
export function closeLayer() {
  const { under } = parseAddress(address());
  if (under) navigate(under);
}

// To the entry just under this one it is the browser's back, so the back after it leaves as it would have and the page
// under keeps its scroll; elsewhere, a link from outside or a reload's, a step of its own.
function goBack(to: Route) {
  if (!traveling && guards() === 0 && entry().from === target(to, parseAddress(address()))) history.back();
  else navigate(to);
}

// NavBar's back; none where back is null, since a sidebar beside the screen is the way back.
export const backBar = (back: Back | null) => (back ? { onBack: () => goBack(back.to), backLabel: back.label } : {});
