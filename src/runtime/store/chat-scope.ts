import type { ApiFailure } from '../api';

export type ScopeState = 'unloaded' | 'loading' | 'loaded' | 'failed';
export type ChatLease = { ready: Promise<ApiFailure | null>; release: () => void };

export class ScopeUnavailable extends Error {
  constructor(readonly chat: string | null) { super(`Chat scope is not loaded: ${chat ?? 'unknown'}`); }
}
