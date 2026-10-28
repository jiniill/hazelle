import { ChangeSignal } from '../change-signal';
import type { ApiFailure, ApiResult } from './api';
import { pause } from './pause';

// The last pause repeats until the server answers or the caller stops.
const RECONNECT_PAUSES = [1000, 2000, 4000, 8000, 15000];
// busy: the server's upload budget is full (server/limits). too-many-writes: the account's batch rate (server/objects).
const WAITED = new Set(['offline', 'account-restoring', 'store-unavailable', 'busy', 'too-many-writes']);
const waits = (result: ApiResult<unknown> | null): result is ApiFailure => result?.ok === false && WAITED.has(result.error);

export class ConnectionWait {
  private readonly changes = new ChangeSignal();
  private calls = 0;

  readonly waiting = () => this.calls > 0;
  readonly subscribe = this.changes.subscribe;

  async run<R extends ApiResult<unknown> | null>(attempt: (signal: AbortSignal) => Promise<R>, stop: AbortSignal): Promise<R | ApiFailure> {
    if (stop.aborted) return { ok: false, error: 'stopped' };
    let result: R | ApiFailure = await attempt(stop);
    if (!waits(result)) return result;
    this.change(1);
    try {
      for (let tries = 0; waits(result); tries++) {
        const after = result.retryAfter === undefined ? RECONNECT_PAUSES[Math.min(tries, RECONNECT_PAUSES.length - 1)]! : result.retryAfter * 1000;
        if (!(await pause(after * (1 + Math.random() * 0.5), stop))) return { ok: false, error: 'stopped' };
        result = await attempt(stop);
      }
      return result;
    } finally {
      this.change(-1);
    }
  }

  private change(by: 1 | -1) {
    this.calls += by;
    this.changes.notify();
  }
}
