const PAGE = /\brealm\.risuai\.net\/\S*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
// Risu's own download (characterCards.ts downloadRisuHub) picks the file form by what comes back.
const FILE_NAMES: Record<string, string> = { 'image/png': 'realm.png', 'application/charx': 'realm.charx', 'application/zip': 'realm.charx' };

export type RealmFailure = 'missing' | 'refused' | 'not-a-bot' | 'lost' | 'cancelled';
export type RealmAnswer = { ok: true; file: File } | { ok: false; failure: RealmFailure };

export const realmId = (text: string) => PAGE.exec(text)?.[1]?.toLowerCase() ?? null;

// Fetched by the browser, never the relay: Realm answers any origin, so this spends no daily relay budget and works for a guest.
export async function downloadRealm(id: string, signal: AbortSignal, progress: (done: number, total: number | undefined) => void): Promise<RealmAnswer> {
  try {
    const response = await fetch(`https://realm.risuai.net/api/v1/download/dynamic/${id}?cors=true`, { headers: { 'x-risu-api-version': '4' }, signal });
    if (response.status === 404) return { ok: false, failure: 'missing' };
    if (!response.ok) return { ok: false, failure: 'refused' };
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    const name = FILE_NAMES[type];
    if (!name || !response.body) return { ok: false, failure: 'not-a-bot' };
    const length = Number(response.headers.get('content-length'));
    const total = length > 0 ? length : undefined;
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let done = 0;
    const reader = response.body.getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      parts.push(read.value);
      done += read.value.byteLength;
      progress(done, total);
    }
    return { ok: true, file: new File(parts, name, { type }) };
  } catch {
    return { ok: false, failure: signal.aborted ? 'cancelled' : 'lost' };
  }
}
