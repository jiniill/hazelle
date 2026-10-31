import type { Release } from '../contracts/installation';
import { api } from './api';

// The tag this page was built from: the Dockerfile hands its HAZELLE_VERSION to Vite. A build without one (dev, tests, a
// local docker build) has none, and then neither compares with the server nor says news.
export const BUILT_VERSION: string | null = (import.meta.env.VITE_HAZELLE_VERSION as string | undefined) || null;

// Read the server's self-host marker before rendering, including signed-out pages. Dev defaults to hosted behavior.
let own = false;
export const selfHost = () => own;
export function markSelfHost(marked: boolean) {
  own = marked;
}

export const readRelease = () => api<Release>('GET', 'release');
