import type { ApiResult } from '../../runtime/api';
import type { BackupOutput } from '../../runtime/backup';
import type { ExportStep } from '../../runtime/card-file';
import type { Toasts } from '../toast';
import { downloadOutput } from './download';
import { SAVING_FILE } from './words';

export type ExportWrite<T> = (output: BackupOutput, progress: (step: ExportStep) => void) => Promise<ApiResult<T>>;
type Said = { message: string; detail?: string };
// The toasts, or what stands for them where a failure is said in place.
type Say = Pick<Toasts, 'error' | 'failed'>;

export const FILE_UNSAVED: Said = { message: '파일을 저장하지 못했어요.', detail: '저장 공간을 확인한 뒤 다시 시도해 주세요.' };
const SAID: Record<string, Said> = { 'export-write': FILE_UNSAVED, unreadable: { message: '내보내지 못했어요.', detail: '열리지 않는 이미지가 있어요.' } };

// Call directly from the press so the save picker retains activation. show clears busy state with null on exit.
// doing: the busy words. own: what the write's own failures say.
export function runExport<T>(
  say: Say,
  filename: string,
  write: ExportWrite<T>,
  show: (label: string | null) => void,
  done: (data: T) => void,
  { doing = '내보내는 중', own = {} }: { doing?: string; own?: Record<string, Said> } = {},
) {
  const destination = downloadOutput(filename);
  show(doing);
  void (async () => {
    try {
      const made = await write(await destination, ({ done, total }) => show(done < total ? `${doing} · ${done} / ${total}` : `${SAVING_FILE} 중`));
      if (made.ok) return done(made.data);
      // Only a write given a stop ends so, at the person's own press.
      if (made.error === 'stopped') return;
      const said = own[made.error] ?? SAID[made.error];
      if (said) say.error(said.message, { detail: said.detail });
      else say.failed(made, '내보내지 못했어요.');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) say.error(FILE_UNSAVED.message);
    } finally {
      show(null);
    }
  })();
}
