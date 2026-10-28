// Frame: [u32 length of remainder][u8 type][u32 seq][body]. hello is a cleartext ECDH key; other bodies are sealed.
// ping is empty, unstored, seq 0; skip its type before checking seq so it cannot affect reply replay.
export const HELLO = 0;
export const HEAD = 1;
export const DATA = 2;
export const END = 3;
export const PING = 4;
// Before a try is sent again (Retry); its body is empty. It comes only before head: past head the reply is the reader's.
export const WAIT = 5;

// Retry only before forwarding any output; times counts additional attempts.
// The connector chooses transient statuses; unreachable providers are also retryable.
export type Retry = { times: number; statuses: readonly number[] };
export const RETRY_MOST = 5;
// A Retry-After past this is the provider saying no for now, and the failure is final.
const WAIT_MOST_MS = 60_000;

// How long to wait after the tries-th try failed: the provider's Retry-After, in seconds or as a date, else 2 s doubling
// with each try. null: longer than most; reconnecting readers can outwait the provider retry limit.
export function retryWait(tries: number, retryAfter: string | null, now: number, most = WAIT_MOST_MS): number | null {
  const asked = retryAfter === null ? NaN : /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
  if (Number.isNaN(asked)) return 1000 * 2 ** tries;
  return asked > most ? null : Math.max(0, asked);
}
