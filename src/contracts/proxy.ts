// The proxy (src/proxy/worker.ts, design §3): a second exit the operator runs, which an account may pick over the server's
// own address. The server hands it the call a connector built: the target and the target's headers in these two, the
// method and the body as its own.
export const PROXY_TARGET_HEADER = 'x-proxy-url';
export const PROXY_HEADERS_HEADER = 'x-proxy-headers';
// Who answered, on every answer the worker itself gives: the provider, or the worker saying the provider could not be
// reached. An answer without it is not the worker's (a wrong key, its host's own error page).
export const PROXY_HEADER = 'x-proxy';
export const PROXY_SOURCE = { upstream: 'upstream', error: 'error' } as const;

// A header's value is Latin-1, which a provider's header need not be.
export const packHeaders = (headers: Iterable<[string, string]>) => encodeURIComponent(JSON.stringify([...headers]));

export function unpackHeaders(packed: string | null): [string, string][] | null {
  if (packed === null) return null;
  try {
    const headers: unknown = JSON.parse(decodeURIComponent(packed));
    return Array.isArray(headers) && headers.every((each) => Array.isArray(each) && each.length === 2 && each.every((part) => typeof part === 'string')) ? (headers as [string, string][]) : null;
  } catch {
    return null;
  }
}
