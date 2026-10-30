import { useSyncExternalStore } from 'react';

// Every media query in the app. Stylesheets cannot read these, so each writes its query out in full,
// and media.test.ts fails on an @media that is not one of them.
export const MEDIA = {
  // Room for the sidebar beside the page. narrow is its complement: change the two together.
  wide: '(min-width: 960px)',
  narrow: '(max-width: 959px)',
  split: '(min-width: 1200px)',
  panelCovers: '(max-width: 1279px)',
  darkScheme: '(prefers-color-scheme: dark)',
  // A phone's width. phone is its complement: change the two together.
  roomy: '(min-width: 600px)',
  phone: '(max-width: 599px)',
  // A mouse or trackpad, where a focused search raises no on-screen keyboard.
  finePointer: '(pointer: fine)',
  // A finger: no Shift key, an on-screen keyboard that a focus raises, and targets it has to hit.
  coarsePointer: '(pointer: coarse)',
  // A touch screen keeps :hover on whatever was tapped last.
  hover: '(hover: hover)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  // Opened from the home screen rather than a browser tab.
  installed: '(display-mode: standalone)',
} as const;

type Query = { subscribe: (listener: () => void) => () => void; read: () => boolean };
const queries = new Map<string, Query>();

export function mediaQuery(query: string): Query {
  const found = queries.get(query);
  if (found) return found;
  let list: MediaQueryList | undefined;
  const readList = () => (list ??= matchMedia(query));
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const subscribe = (listener: () => void) => {
    if (listeners.size === 0) readList().addEventListener('change', changed);
    listeners.add(listener);
    return () => {
      if (listeners.delete(listener) && listeners.size === 0) readList().removeEventListener('change', changed);
    };
  };
  const state = { subscribe, read: () => readList().matches };
  queries.set(query, state);
  return state;
}

function watch(query: string) {
  const { subscribe, read } = mediaQuery(query);
  return () => useSyncExternalStore(subscribe, read);
}

export const useWide = watch(MEDIA.wide);

export const useSplit = watch(MEDIA.split);

export const usePanelCovers = watch(MEDIA.panelCovers);

// Two side panels fit beside the page, neither covering it (ChatFrame's beside).
export const usePanelsBeside = () => !usePanelCovers();

export const useHover = watch(MEDIA.hover);

export const useCoarsePointer = watch(MEDIA.coarsePointer);

export const useDarkScheme = watch(MEDIA.darkScheme);
export const isDarkScheme = () => mediaQuery(MEDIA.darkScheme).read();

// A string, so an unchanged size is the same snapshot.
const subscribeResize = (listener: () => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};
export const useViewport = () => useSyncExternalStore(subscribeResize, () => `${innerWidth}x${innerHeight}`);

export const hasFinePointer = () => mediaQuery(MEDIA.finePointer).read();
export const isInstalled = () => mediaQuery(MEDIA.installed).read();
