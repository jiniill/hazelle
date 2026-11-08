import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeSignal } from '../../change-signal';
import { HOSTED } from '../../contracts/installation';
import { markSelfHost } from '../../runtime/installation';
import { closeLayer, holdBack, navigate } from './router';
import { href, type Route } from './routes';

afterEach(() => {
  markSelfHost(false);
  vi.unstubAllGlobals();
});

it("opens every way into a self-host's 게시판 on hazelle.app and leaves the page where it is", () => {
  const open = vi.fn();
  const pushState = vi.fn();
  vi.stubGlobal('window', { open });
  vi.stubGlobal('history', { pushState });
  vi.stubGlobal('location', { pathname: '/', search: '', hash: '' });
  markSelfHost(true);
  navigate({ kind: 'board', operator: false, category: 'news' });
  navigate({ kind: 'post', id: 7 });
  expect(open.mock.calls).toEqual([[`${HOSTED}/board?category=news`, '_blank', 'noopener'], [`${HOSTED}/board/7`, '_blank', 'noopener']]);
  expect(pushState).not.toHaveBeenCalled();
});

const popstate = new Set<() => void>();

// A session history as a browser keeps it: a traversal waits for land(), as history.go does.
function browser(state: unknown = null, start = '/') {
  const entries = [{ state: null as unknown, url: start }];
  if (state !== null) entries.push({ state, url: start });
  let at = entries.length - 1;
  const hops: number[] = [];
  const scrollTo = vi.fn();
  const land = () => {
    at += hops.shift()!;
    for (const listener of popstate) listener();
  };
  vi.stubGlobal('window', { addEventListener: (_: string, listener: () => void) => popstate.add(listener), dispatchEvent: () => true, scrollTo });
  vi.stubGlobal('location', {
    get pathname() {
      return entries[at]!.url.split('#')[0];
    },
    get hash() {
      const url = entries[at]!.url;
      return url.includes('#') ? url.slice(url.indexOf('#')) : '';
    },
    search: '',
  });
  vi.stubGlobal('history', {
    get state() {
      return entries[at]!.state;
    },
    pushState(next: unknown, _: string, url = entries[at]!.url) {
      entries.splice(at + 1, Infinity, { state: next, url });
      at += 1;
    },
    replaceState(next: unknown, _: string, url = entries[at]!.url) {
      entries[at] = { state: next, url };
    },
    go: (by: number) => hops.push(by),
  });
  return {
    land,
    scrollTo,
    url: () => entries[at]!.url,
    at: () => at,
    back: () => {
      hops.push(-1);
      land();
    },
  };
}

// set stands for a commit: the router hears of it only after the effects, in a microtask.
function layers() {
  const signal = new ChangeSignal();
  const open: string[] = [];
  const set = async (...names: string[]) => {
    open.splice(0, Infinity, ...names);
    signal.notify();
    await Promise.resolve();
  };
  return { open, set, count: () => open.length, closeAbove: (keep: number) => void open.splice(keep), subscribe: signal.subscribe };
}

const MINE: Route = { kind: 'board-mine' };
const SEARCH: Route = { kind: 'search', query: '' };

describe('back with overlays open', () => {
  let release = () => {};
  afterEach(() => release());
  function start(page = browser()) {
    const overlays = layers();
    release = holdBack(overlays);
    return { page, overlays };
  }

  it('closes the newest and stays, and the next back goes on as usual', async () => {
    const { page, overlays } = start();
    navigate(MINE);
    await overlays.set('menu');
    page.back();
    expect(overlays.open).toEqual([]);
    expect(page.url()).toBe(href(MINE));
    page.back();
    expect(page.url()).toBe('/');
  });

  it('gives its entry up when closed some other way, leaving no dead back and no scroll reset', async () => {
    const { page, overlays } = start();
    navigate(MINE);
    page.scrollTo.mockClear();
    await overlays.set('menu');
    await overlays.set();
    page.land();
    expect(page.at()).toBe(1);
    expect(page.scrollTo).not.toHaveBeenCalled();
    page.back();
    expect(page.url()).toBe('/');
  });

  it('waits for the entry to be given up before a route writes history', async () => {
    const { page, overlays } = start();
    await overlays.set('menu');
    await overlays.set();
    navigate(SEARCH);
    expect(page.url()).toBe('/');
    page.land();
    expect(page.url()).toBe(href(SEARCH));
    page.back();
    expect(page.url()).toBe('/');
  });

  it('lets an item navigate in one step, its guard becoming the route', async () => {
    const { page, overlays } = start();
    await overlays.set('menu');
    navigate(SEARCH);
    expect(page.url()).toBe(href(SEARCH));
    await overlays.set();
    page.back();
    expect(page.url()).toBe('/');
  });

  it('keeps a guard for an overlay that stays across the route', async () => {
    const { page, overlays } = start();
    await overlays.set('dialog');
    navigate(SEARCH);
    await Promise.resolve();
    page.back();
    expect(overlays.open).toEqual([]);
    expect(page.url()).toBe(href(SEARCH));
    page.back();
    expect(page.url()).toBe('/');
  });

  it('takes the page itself on a replace from inside', async () => {
    const { page, overlays } = start();
    navigate(MINE);
    await overlays.set('dialog');
    navigate(SEARCH, { replace: true });
    await overlays.set();
    page.land();
    expect(page.url()).toBe(href(SEARCH));
    page.back();
    expect(page.url()).toBe('/');
  });

  it('closes stacked overlays one back each, and a nested item leaves no entry behind', async () => {
    const { page, overlays } = start();
    await overlays.set('dialog', 'menu');
    page.back();
    expect(overlays.open).toEqual(['dialog']);
    await overlays.set('dialog', 'menu');
    navigate(SEARCH);
    await overlays.set();
    page.land();
    expect(page.url()).toBe(href(SEARCH));
    page.back();
    expect(page.url()).toBe('/');
  });

  it('nets a menu replacing another out to no history', async () => {
    const { page, overlays } = start();
    await overlays.set('one');
    void overlays.set();
    await overlays.set('two');
    expect(page.at()).toBe(1);
  });

  it('gives up a guard a reload or a forward left with nothing open', () => {
    const { page } = start(browser({ guards: 1 }));
    page.land();
    expect(page.at()).toBe(0);
  });
});

describe('a layer over a page', () => {
  let release = () => {};
  afterEach(() => release());
  const CHAT: Route = { kind: 'chat', id: '00000000-0000-4000-8000-000000000001' };
  const SHELF: Route = { kind: 'shelf', character: null };
  const DISPLAY: Route = { kind: 'display' };
  const CONTROLS: Route = { kind: 'controls' };
  const PROMPT: Route = { kind: 'prompt', id: '00000000-0000-4000-8000-000000000002', pane: null };
  const over = (route: Route) => `${href(CHAT)}#${href(route)}`;
  function start(page = browser()) {
    release = holdBack(layers());
    return page;
  }

  it('walks in the hash and closes back to the page it was opened from, leaving no entry to back into', () => {
    const page = start();
    navigate(CHAT);
    navigate(DISPLAY);
    expect(page.url()).toBe(over(DISPLAY));
    navigate(CONTROLS, { replace: true });
    navigate(PROMPT);
    page.back();
    expect(page.url()).toBe(over(CONTROLS));
    navigate(PROMPT);
    closeLayer();
    page.land();
    expect(page.url()).toBe(href(CHAT));
    page.back();
    expect(page.url()).toBe('/');
  });

  it('leaves for another page from the one under it', () => {
    const page = start();
    navigate(CHAT);
    navigate(DISPLAY);
    navigate(PROMPT);
    navigate(SHELF);
    page.land();
    expect(page.url()).toBe(href(SHELF));
    page.back();
    expect(page.url()).toBe(href(CHAT));
  });

  it('opened from a link stands over home, and closes in place', () => {
    const page = start(browser(null, href(DISPLAY)));
    navigate(CONTROLS);
    expect(page.url()).toBe(`/#${href(CONTROLS)}`);
    closeLayer();
    expect(page.url()).toBe('/');
    expect(page.at()).toBe(1);
  });
});
