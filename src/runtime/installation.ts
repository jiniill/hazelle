import type { Release } from '../contracts/installation';
import { api } from './api';

// Written on <html> by the server (static.ts PageStamp), never compiled in: a tag in the chunks would rename most of them
// each release, and a tab left open would lose them with no change to the page. A server without a tag (dev, tests, a
// local docker build) writes neither, and then the page neither compares with the server nor says news.
const stamped = typeof document === 'undefined' ? {} : document.documentElement.dataset;
export const BUILT_VERSION: string | null = stamped['version'] ?? null;
export const PAGE_BUILD: string | null = stamped['build'] ?? null;

// Read the server's self-host marker before rendering, including signed-out pages. Dev defaults to hosted behavior.
let own = false;
export const selfHost = () => own;
export function markSelfHost(marked: boolean) {
  own = marked;
}

// What follows the app's own bundle in a script's address; null for an address anywhere else (an extension's, a
// plugin frame's, another site's), whose file names are not the app's to tell.
export function ownScript(url: string): string | null {
  const bundle = `${location.origin}/assets/`;
  return url.startsWith(bundle) ? url.slice(bundle.length) : null;
}

export const readRelease = () => api<Release>('GET', 'release');
