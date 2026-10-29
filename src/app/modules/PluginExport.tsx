import { exportTool } from '../../runtime/tools/store';
import type { ToolManifest } from '../../tool-api/manifest';
import { fileNamed } from '../common/download';
import { runExport } from '../common/exporting';
import { FileExport } from '../common/FileExport';
import { moduleName, RISU_PLUGIN, TOOL } from '../common/words';
import { useFiles, useStore } from '../session';
import { useToast } from '../toast';

const LEFT = '헤이젤에서 바꾼 설정값과 플러그인이 저장한 데이터는 빠져요.';
const OPENS = { risu: 'RisuAI 설정 › 플러그인에서 가져올 수 있어요.', hazelle: '플러그인 가져오기로 열 수 있어요.' };

export function PluginExport({ id, name, manifest, onClose }: { id: string; name: string; manifest: ToolManifest; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const file = fileNamed(name, TOOL, 'js');

  function save(show: (label: string | null) => void) {
    runExport(toast, file, (output) => exportTool(store, files, id, output), show, () => {
      toast.show(`'${moduleName(name)}' ${TOOL}을 내보냈어요.`);
      onClose();
    });
  }

  const format = manifest.risu ? RISU_PLUGIN : `헤이젤 ${TOOL}`;
  return <FileExport format={format} file={file} help={`${manifest.risu ? OPENS.risu : OPENS.hazelle} ${LEFT}`} blocked={null} onExport={save} onClose={onClose} />;
}
