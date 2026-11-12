import { exportTool } from '../../runtime/tools/store';
import type { ToolManifest } from '../../tool-api/manifest';
import { fileNamed } from '../common/download';
import { FileExport } from '../common/FileExport';
import { moduleName, RISU_PLUGIN, TOOL } from '../common/words';
import { useFiles, useStore } from '../session';

const LEFT = '헤이젤에서 바꾼 설정값과 플러그인이 저장한 데이터는 빠져요.';
export const OPENS = { risu: 'RisuAI 설정 › 플러그인에서 가져올 수 있어요.', hazelle: '플러그인 가져오기로 열 수 있어요.' };

export function PluginExport({ id, name, manifest, onClose }: { id: string; name: string; manifest: ToolManifest; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const file = fileNamed(name, TOOL, 'js');

  const format = manifest.risu ? RISU_PLUGIN : `헤이젤 ${TOOL}`;
  return (
    <FileExport
      format={format}
      file={file}
      help={`${manifest.risu ? OPENS.risu : OPENS.hazelle} ${LEFT}`}
      blocked={null}
      write={(output) => exportTool(store, files, id, output)}
      done={() => ({ message: `'${moduleName(name)}' ${TOOL}을 내보냈어요.` })}
      onClose={onClose}
    />
  );
}
