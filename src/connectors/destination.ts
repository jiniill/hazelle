// Shared with server outbound policy: UI and relay must match HAZELLE_LOCAL_PROVIDERS identically.
// Entries state a port explicitly because URL.host drops default ports.
export const destination = (url: URL) => `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
