import type { ConversationPrompt } from '../../model/prompt';
import { exportPreset } from '../../runtime/prompts';
import { fileNamed } from '../common/download';
import { FileExport } from '../common/FileExport';
import { SLOT } from '../common/prompt-words';
import { promptName, THINGS } from '../common/words';
import { useStore } from '../session';

// Export spec §3 "Lost" and ruling 9: the prompt's models stay here, Risu keeps its own model settings, and top_p is the
// one Risu resets.
const LEFT = `Risu 프리셋 가져오기로 열거나 창에 끌어다 놓아 열 수 있어요. 모델과 ${SLOT.tool.name} 블록은 빠지고, Risu에서 적용할 때 top_p가 1로 바뀌어요.`;

export function PresetExport({ prompt, onClose }: { prompt: ConversationPrompt; onClose: () => void }) {
  const store = useStore();
  const name = promptName(prompt.name);
  const file = fileNamed(name, THINGS.prompt.noun, 'risup');

  return (
    <FileExport
      format="Risu 프리셋"
      file={file}
      help={LEFT}
      blocked={null}
      write={(output) => exportPreset(store, prompt, output)}
      done={({ tools }) => ({ message: `'${name}' 프롬프트를 내보냈어요.`, detail: tools ? `${SLOT.tool.name} 블록 ${tools}개는 빼고 내보냈어요.` : undefined })}
      onClose={onClose}
    />
  );
}
