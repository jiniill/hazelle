import type { ApiResult } from '../../runtime/api';
import type { BackupOutput } from '../../runtime/backup';
import type { ExportStep } from '../../runtime/card-file';
import type { Toasts } from '../toast';
import { downloadOutput } from './download';
import { SAVING_FILE } from './words';

// Call directly from the press so the save picker retains activation. show clears busy state with null on exit.
export function runExport<T>(
  toast: Toasts,
  filename: string,
  write: (output: BackupOutput, progress: (step: ExportStep) => void) => Promise<ApiResult<T>>,
  show: (label: string | null) => void,
  done: (data: T) => void,
) {
  const destination = downloadOutput(filename);
  show('내보내는 중');
  void (async () => {
    try {
      const made = await write(await destination, ({ done, total }) => show(done < total ? `내보내는 중 · ${done} / ${total}` : `${SAVING_FILE} 중`));
      if (made.ok) done(made.data);
      // Only a write given a stop ends so, at the person's own press.
      else if (made.error === 'stopped') return;
      else if (made.error === 'export-write') toast.error('파일을 저장하지 못했어요.', { detail: '저장 공간을 확인한 뒤 다시 시도해 주세요.' });
      else if (made.error === 'unreadable') toast.error('내보내지 못했어요.', { detail: '열리지 않는 이미지가 있어요.' });
      else toast.failed(made, '내보내지 못했어요.');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error('파일을 저장하지 못했어요.');
    } finally {
      show(null);
    }
  })();
}
