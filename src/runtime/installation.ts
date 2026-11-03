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

export const readRelease = () => api<Release>('GET', 'release');
