import { useMemo, useSyncExternalStore } from 'react';
import { HOSTED } from '../../contracts/installation';
import { selfHost } from '../../runtime/installation';
import { href, onBoard, parseRoute, type Back, type Route } from './routes';

const NAVIGATED = 'risu-alpha:navigate';

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATED, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATED, listener);
  };
}

const address = () => location.pathname + location.search;

export function useRoute(): Route {
  const at = useSyncExternalStore(subscribe, address);
  return useMemo(() => parseRoute(at), [at]);
}

// An open overlay holds one same-URL entry of its own, so a back that closes the newest writes no history. An entry's
// state counts the guards up to it, which is how a reload still knows what it stands on.
type BackLayers = { count: () => number; closeAbove: (keep: number) => void; subscribe: (listener: () => void) => () => void };
let overlays: BackLayers | null = null;
let listening = false;
// history.go lands later, and a history write before it lands puts the entry in the wrong place.
let traveling = false;
let afterTravel: (() => void) | null = null;

const guards = () => (overlays && (history.state as { guards?: number } | null)?.guards) || 0;

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
  while (have < want) history.pushState({ guards: ++have }, '');
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

export function navigate(route: Route, { replace = false } = {}) {
  const at = href(route);
  // A self-host's 게시판 is hazelle.app's, where release news and questions meet, so every way into it opens there.
  if (selfHost() && onBoard(route)) return void window.open(HOSTED + at, '_blank', 'noopener');
  if (at === address()) return;
  // The menu an item closes is still counted here, since its layer leaves in an effect after this call. Its guard
  // becomes the new route's entry, so one back returns from the route; a replace must take the entry under the guards.
  const have = guards();
  const keep = replace ? 0 : 1;
  if (traveling || have > keep) {
    afterTravel = () => navigate(route, { replace });
    if (!traveling) travel(keep - have);
    return;
  }
  history[replace || have > 0 ? 'replaceState' : 'pushState'](null, '', at);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(NAVIGATED));
}

// NavBar's back; none where back is null, since a sidebar beside the screen is the way back.
export const backBar = (back: Back | null) => (back ? { onBack: () => navigate(back.to), backLabel: back.label } : {});
