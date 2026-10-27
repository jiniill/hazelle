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

export function navigate(route: Route, { replace = false } = {}) {
  const at = href(route);
  // A self-host's 게시판 is hazelle.app's, where release news and questions meet, so every way into it opens there.
  if (selfHost() && onBoard(route)) return void window.open(HOSTED + at, '_blank', 'noopener');
  if (at === address()) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', at);
  window.scrollTo(0, 0);
  window.dispatchEvent(new Event(NAVIGATED));
}

// NavBar's back; none where back is null, since a sidebar beside the screen is the way back.
export const backBar = (back: Back | null) => (back ? { onBack: () => navigate(back.to), backLabel: back.label } : {});
