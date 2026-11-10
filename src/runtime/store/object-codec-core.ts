import { errorMessage } from '../../error-message';
import { openObject, sealObject, type ObjectAddress } from '../../vault/objects';

export type OpenItem = ObjectAddress & { body: string };
export type SealItem = ObjectAddress & { value: unknown };
export type CodecJob = { kind: 'open'; items: OpenItem[] } | { kind: 'seal'; items: SealItem[]; limit: number };
export type CodecResult<T = unknown> = { ok: true; value: T } | { ok: false; name: string; message: string };
export type CodecDown = { kind: 'init'; account: string; key: CryptoKey } | { kind: 'batch'; id: number; job: CodecJob };
export type CodecUp = { id: number; results: CodecResult[] };

// The worker and the tests' in-process worker share this adapter and the vault's one wire codec.
// Item failures stay ordered with successes: an opener may mark them unreadable, but a backup must fail.
export async function codeObjects(key: CryptoKey, account: string, job: CodecJob): Promise<CodecResult[]> {
  return Promise.all(job.items.map(async (item): Promise<CodecResult> => {
    try {
      if (job.kind === 'open') return { ok: true, value: await openObject(key, account, item, (item as OpenItem).body) };
      const body = await sealObject(key, account, item, (item as SealItem).value);
      // An oversized body never crosses back to the caller only to be discarded there.
      return { ok: true, value: body.length > job.limit ? null : body };
    } catch (error) {
      return { ok: false, name: error instanceof Error ? error.name : 'Error', message: errorMessage(error) };
    }
  }));
}

export function codecValue<T>(result: CodecResult<T>): T {
  if (result.ok) return result.value;
  const error = new Error(result.message);
  error.name = result.name;
  throw error;
}
