import type { FileSweep, HeldFiles, MissingFiles, SweptFiles } from '../contracts/files';
import type { BatchAnswer, FeedAnswer, FeedQuery, SealedWrite } from '../contracts/objects';
import { api, type ApiResult } from './api';

// Server and guest IndexedDB backends must expose identical sealed object/file semantics to store and Files.
export interface Backend {
  feed(query: FeedQuery, signal?: AbortSignal): Promise<ApiResult<FeedAnswer>>;
  batch(timeline: string, writes: SealedWrite[], files: string[], signal?: AbortSignal): Promise<ApiResult<BatchAnswer>>;
  missingFiles(ids: string[]): Promise<ApiResult<MissingFiles>>;
  putFile(id: string, body: Uint8Array<ArrayBuffer>): Promise<ApiResult<unknown>>;
  readFile(id: string): Promise<ApiResult<Uint8Array<ArrayBuffer>>>;
  heldFiles(after: string | null): Promise<ApiResult<HeldFiles>>;
  sweepFiles(sweep: FileSweep): Promise<ApiResult<SweptFiles>>;
}

// The server's defaults, so a query states only what it asks.
export const feedQuery = (ask: Partial<FeedQuery> & Pick<FeedQuery, 'since' | 'timeline'>): FeedQuery => ({ known: ask.since, until: null, bootstrap: false, metadata: false, excluded: [], parent: null, kind: null, count: false, ...ask });

export function serverBackend(request: typeof api = api): Backend {
  return {
    feed: (query, signal) => request<FeedAnswer>('GET', `objects?${feedSearch(query)}`, undefined, signal),
    batch: (timeline, writes, files, signal) => request<BatchAnswer>('POST', 'objects/batch', { timeline, writes, files }, signal),
    missingFiles: (ids) => request<MissingFiles>('POST', 'files/missing', { ids }),
    putFile: (id, body) => request('PUT', `files/${id}`, body),
    readFile: (id) => request<Uint8Array<ArrayBuffer>>('GET', `files/${id}`),
    heldFiles: (after) => request<HeldFiles>('GET', after ? `files?after=${after}` : 'files'),
    sweepFiles: (sweep) => request<SweptFiles>('POST', 'files/sweep', sweep),
  };
}

// The inverse of server/objects.ts's reading: a field at the server's default is left out.
function feedSearch({ since, known, until, bootstrap, metadata, excluded, parent, kind, count, timeline }: FeedQuery): string {
  return [
    `since=${since}`,
    excluded.length && `exclude=${excluded.join(',')}`,
    bootstrap && 'bootstrap=1',
    until !== null && `until=${until}`,
    count && 'count=1',
    parent !== null && `parent=${encodeURIComponent(parent)}`,
    kind !== null && `kind=${kind}`,
    metadata && 'metadata=1',
    known !== since && `known=${known}`,
    timeline !== null && `timeline=${encodeURIComponent(timeline)}`,
  ].filter(Boolean).join('&');
}
