export type Timing = { at: number; ms: number; ok: boolean; status: number | string };

export type Summary = { count: number; failed: number; p50: number; p95: number; max: number };

// Open loop: a request is sent every intervalMs whether or not the one before has answered, so a stalled server shows
// as long timings rather than as fewer requests.
export function probe(intervalMs: number, request: () => Promise<Response | number>) {
  const timings: Timing[] = [];
  const flying = new Set<Promise<void>>();
  const send = () => {
    const at = Date.now();
    const started = performance.now();
    const done = request()
      .then(async (answer) => {
        const status = typeof answer === 'number' ? answer : answer.status;
        if (typeof answer !== 'number') await answer.body?.cancel();
        timings.push({ at, ms: performance.now() - started, ok: status < 400, status });
      })
      .catch((error: unknown) => {
        timings.push({ at, ms: performance.now() - started, ok: false, status: error instanceof Error ? error.name : String(error) });
      })
      .finally(() => flying.delete(done));
    flying.add(done);
  };
  const timer = setInterval(send, intervalMs);
  send();
  return {
    timings,
    stop: async () => {
      clearInterval(timer);
      await Promise.all(flying);
      return timings;
    },
  };
}

export function summarize(timings: Timing[]): Summary {
  const sorted = timings.map(({ ms }) => ms).sort((a, b) => a - b);
  const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : NaN);
  return { count: sorted.length, failed: timings.filter(({ ok }) => !ok).length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? NaN };
}

export const within = (timings: Timing[], from: number, to: number) => timings.filter(({ at }) => at >= from && at < to);

export function peaks(samples: { at: number; cpuPercent: number; memBytes: number; rssBytes: number | null }[], from = 0, to = Infinity) {
  const inside = samples.filter(({ at }) => at >= from && at < to);
  const most = (values: number[]) => values.filter(Number.isFinite).reduce((a, b) => Math.max(a, b), -Infinity);
  return {
    cpuPercent: most(inside.map(({ cpuPercent }) => cpuPercent)),
    memMb: most(inside.map(({ memBytes }) => memBytes)) / 2 ** 20,
    rssMb: most(inside.flatMap(({ rssBytes }) => (rssBytes === null ? [] : [rssBytes]))) / 2 ** 20,
  };
}

export async function pool<T>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await work(items[index]!, index);
      }
    }),
  );
}

// Record WSL2 wall-clock catch-up steps: monotonic time may lag, skewing server gate_ms/backup_runs comparisons.
export function clockSteps() {
  const steps: { at: number; stepMs: number }[] = [];
  let offset = Date.now() - performance.now();
  const timer = setInterval(() => {
    const now = Date.now() - performance.now();
    if (Math.abs(now - offset) > 100) steps.push({ at: Date.now(), stepMs: Math.round(now - offset) });
    offset = now;
  }, 50);
  return { steps, stop: () => clearInterval(timer) };
}
