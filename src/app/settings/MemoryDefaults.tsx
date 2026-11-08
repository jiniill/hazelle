import { retrievalRoom } from '../../engine/retrieval';
import type { MemorySettings } from '../../model/memory';
import { SHARED_CHAT } from '../../runtime/features';
import { defaultMemory, memoryWriter } from '../../runtime/memory-read';
import { setDefaultMemory } from '../../runtime/memory';
import { describeMemoryFailure } from '../common/failure';
import { MemoryFields, MemorySplit } from '../common/MemoryFields';
import { AccountTaskModel } from '../common/TaskPrompt';
import { count } from '../common/typedNumber';
import { useAutosave } from '../common/useAutosave';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';

const amount = (tokens: number) => `${count(tokens)} 토큰`;

export function MemoryDefaults() {
  const store = useStore();
  // Subscribed for their changes: defaultMemory and memoryWriter read these from the store.
  useSettings();
  usePrompts();
  useConnections();
  useProfiles();
  const writer = memoryWriter(store, SHARED_CHAT);
  const save = useAutosave<MemorySettings>('memory-defaults', (patch) => setDefaultMemory(store, patch));
  const value = { ...defaultMemory(store), ...save.unsaved };
  const found = retrievalRoom(value.budget);
  const sum = value.budget + found + value.batch + value.window;
  return (
    <MemoryFields value={value} onChange={save.change} label="새 채팅에서 켜기" rows={<AccountTaskModel task="memory" runs={'kind' in writer ? { why: describeMemoryFailure(writer) } : writer} />}>
      {/* Off, a request fills no memory slot, so this split is not what it sends. */}
      {value.on && (
        <MemorySplit
          total={{ label: '요청마다 보내는 기록과 대화', value: `최대 ${amount(sum)}` }}
          whole={sum}
          records={{ tokens: value.budget, value: `최대 ${amount(value.budget)}` }}
          found={{ tokens: found, value: `최대 ${amount(found)}` }}
          waiting={{ tokens: value.batch, value: `최대 ${amount(value.batch)}` }}
          recent={{ tokens: value.window, value: amount(value.window) }}
        />
      )}
    </MemoryFields>
  );
}
