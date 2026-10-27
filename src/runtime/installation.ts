import type { Release } from '../contracts/installation';
import { api } from './api';

// Read the server's self-host marker before rendering, including signed-out pages. Dev defaults to hosted behavior.
let own = false;
export const selfHost = () => own;
export function markSelfHost(marked: boolean) {
  own = marked;
}

export const readRelease = () => api<Release>('GET', 'release');
