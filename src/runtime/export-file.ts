import type { ApiResult } from './api';
import type { BackupOutput } from './backup-zip';

// Abort failed writes so exporting never leaves a partial small file behind.
export async function writeWhole(output: BackupOutput, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<null>> {
  try {
    await output.write(bytes);
    await output.close();
    return { ok: true, data: null };
  } catch {
    await output.abort();
    return { ok: false, error: 'export-write' };
  }
}
