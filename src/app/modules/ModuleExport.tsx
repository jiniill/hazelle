import { exportModule } from '../../runtime/export/card-file';
import { fileNamed } from '../common/download';
import { FileExport } from '../common/FileExport';
import { moduleName } from '../common/words';
import { useFiles, useStore } from '../session';

const LEFT =
  'RisuAI 설정 › 모듈에서 가져오거나 창에 끌어다 놓아 열 수 있어요. 삽화 프로필, 꺼 둔 스크립트·로어북, 로어북 우선순위와 삽입 위치는 제외되며, 쉼표가 포함된 키워드는 여러 개로 분리돼요.';

export function ModuleExport({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const store = useStore();
  const files = useFiles();
  const file = fileNamed(name, moduleName(''), 'risum');

  return (
    <FileExport
      format="Risu 모듈"
      file={file}
      help={LEFT}
      blocked={null}
      write={(output, progress) => exportModule(store, files, id, output, progress)}
      done={() => ({ message: `'${moduleName(name)}' 모듈을 내보냈어요.` })}
      onClose={onClose}
    />
  );
}
