import { PACKED_EXTENSION, UNPACKED_EXTENSIONS } from '../../engine/import/extensions';
import { detachedReplies, relay, type RelayFailure } from '../models/relay';

const REALM_PAGE = /\brealm\.risuai\.net\/\S*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const PROTON_LINK = /\bhttps:\/\/drive\.proton\.me\/urls\/[\w-]+#\S+/i;
const WEB_ADDRESS = /https:\/\/\S+/i;
// Risu's own download (characterCards.ts downloadRisuHub) picks the file form by what comes back.
const REALM_FILES: Record<string, string> = { 'image/png': 'realm.png', 'application/charx': 'realm.charx', 'application/zip': 'realm.charx' };
const MOST_REDIRECTS = 5;

// password: the one its owner set on a Proton link, which the link's address does not hold.
export type BotLink = { kind: 'realm'; id: string } | { kind: 'proton'; url: string; password?: string } | { kind: 'direct'; url: string };
export type LinkFailure =
  | { kind: 'cancelled' }
  | { kind: 'needs-password' }
  | { kind: 'wrong-password' }
  | { kind: 'missing' | 'refused' | 'not-a-file' | 'guest-blocked' | 'needs-account' | 'no-bot-file' | 'damaged' | 'lost' }
  | { kind: 'relay'; failure: RelayFailure };
// skipped: files the link held that the import does not read.
export type LinkAnswer = { ok: true; files: File[]; skipped: string[] } | { ok: false; failure: LinkFailure };
export type Progress = (done: number, total: number | undefined) => void;

export function readLink(text: string): BotLink | null {
  const realm = REALM_PAGE.exec(text)?.[1];
  if (realm) return { kind: 'realm', id: realm.toLowerCase() };
  const proton = PROTON_LINK.exec(text)?.[0];
  if (proton) return { kind: 'proton', url: proton };
  const url = WEB_ADDRESS.exec(text)?.[0];
  return url && URL.canParse(url) ? { kind: 'direct', url } : null;
}

export async function downloadLink(link: BotLink, signal: AbortSignal, progress: Progress): Promise<LinkAnswer> {
  try {
    const answer = await download(link, signal, progress);
    return answer.ok && answer.files.length === 0 ? { ok: false, failure: { kind: 'no-bot-file' } } : answer;
  } catch {
    return { ok: false, failure: { kind: signal.aborted ? 'cancelled' : 'lost' } };
  }
}

async function download(link: BotLink, signal: AbortSignal, progress: Progress): Promise<LinkAnswer> {
  switch (link.kind) {
    case 'realm':
      return downloadRealm(link.id, signal, progress);
    case 'direct':
      return downloadDirect(link.url, signal, progress);
    case 'proton': {
      // Proton's API answers no other site's page, so only the relay reaches it; a guest has none. The module is heavy: it loads for this link alone.
      if (!detachedReplies()) return { ok: false, failure: { kind: 'needs-account' } };
      const { downloadProton } = await import('./proton');
      return downloadProton(link.url, link.password, signal, progress);
    }
  }
}

async function bodyOf(response: Response, progress: Progress) {
  const length = Number(response.headers.get('content-length'));
  const total = length > 0 ? length : undefined;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let done = 0;
  const reader = response.body!.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    parts.push(read.value);
    done += read.value.byteLength;
    progress(done, total);
  }
  return parts;
}

// Fetched by the browser, never the relay: Realm answers any origin, so this spends no daily relay budget and works for a guest.
async function downloadRealm(id: string, signal: AbortSignal, progress: Progress): Promise<LinkAnswer> {
  const response = await fetch(`https://realm.risuai.net/api/v1/download/dynamic/${id}?cors=true`, { headers: { 'x-risu-api-version': '4' }, signal });
  if (response.status === 404) return { ok: false, failure: { kind: 'missing' } };
  if (!response.ok) return { ok: false, failure: { kind: 'refused' } };
  const type = mediaOf(response);
  const name = REALM_FILES[type];
  if (!name || !response.body) return { ok: false, failure: { kind: 'not-a-file' } };
  return { ok: true, files: [new File(await bodyOf(response, progress), name, { type })], skipped: [] };
}

const mediaOf = (response: Response) => response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';

// The relay reports a redirect instead of following it, so each hop is a call of its own against the daily budget.
async function downloadDirect(address: string, signal: AbortSignal, progress: Progress): Promise<LinkAnswer> {
  let url = address;
  for (let hops = 0; hops <= MOST_REDIRECTS; hops++) {
    const response = await relay({ method: 'GET', url, headers: {}, body: null }, signal);
    if (response instanceof Response) {
      if (mediaOf(response) === 'text/html' || !response.body) return { ok: false, failure: { kind: 'not-a-file' } };
      const parts = await bodyOf(response, progress);
      return { ok: true, files: [new File(parts, fileName(url, response.headers.get('content-disposition'), parts[0]))], skipped: [] };
    }
    if (response.kind === 'relay' && response.code === 'upstream-redirect' && response.location) {
      url = new URL(response.location, url).href;
      continue;
    }
    if (response.kind === 'relay' && response.code === 'upstream-not-api') return { ok: false, failure: { kind: 'not-a-file' } };
    if (response.kind === 'provider') return { ok: false, failure: { kind: response.status === 404 || response.status === 410 ? 'missing' : 'refused' } };
    if (response.kind === 'stopped') return { ok: false, failure: { kind: 'cancelled' } };
    // A guest's browser asks the site itself, and most sites answer no one but their own pages.
    if (response.kind === 'offline' && !detachedReplies()) return { ok: false, failure: { kind: 'guest-blocked' } };
    return { ok: false, failure: { kind: 'relay', failure: response } };
  }
  return { ok: false, failure: { kind: 'refused' } };
}

function dispositionName(header: string | null) {
  const encoded = /filename\*\s*=\s*utf-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // The plain filename beside it, or the address, still names the file.
    }
  }
  return /filename\s*=\s*"?([^";]+)"?/i.exec(header ?? '')?.[1]?.trim();
}

function addressName(url: string) {
  const last = new URL(url).pathname.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// The import goes by extension, and a download link often names no file: the first bytes say which one it can be.
export function fileName(url: string, disposition: string | null, head: Uint8Array | undefined): string {
  const name = (dispositionName(disposition) ?? addressName(url)).replace(/^.*[\\/]/, '') || 'link';
  const lower = name.toLowerCase();
  if ([...UNPACKED_EXTENSIONS, PACKED_EXTENSION].some((extension) => lower.endsWith(extension))) return name;
  if (head?.[0] === 0x89 && head[1] === 0x50) return `${name}.png`;
  if (head?.[0] === 0x50 && head[1] === 0x4b) return `${name}${PACKED_EXTENSION}`;
  if (head?.[0] === 0x7b) return `${name}.json`;
  return name;
}
