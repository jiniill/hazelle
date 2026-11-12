import type { Stored } from '../../model/kinds';
import { live } from '../../model/library';
import { sortOf, type PromptSort } from '../../model/prompt';
import { copyPrompt, editPrompt, isDefaultPrompt, removePrompt, resetPromptBlocks, restorePrompt, setDefaultPrompt, type PromptPatch } from '../../runtime/library/prompts';
import { ACTS } from '../common/acts';
import { defaultPrompt } from '../common/prompt-words';
import { useAutosave } from '../common/useAutosave';
import { useMaking } from '../common/useMaking';
import { useRemoval } from '../common/useRemoval';
import { BIN_KEEPS, cannotRemove, ORIGINAL_GONE, promptName, SEE_ORIGINAL, SET_DEFAULT, THINGS, SET_DEFAULT_FAILED } from '../common/words';
import { useSettings, useStore, useStored } from '../session';
import { useToast } from '../toast';
import { MenuItem } from '../ui';

const MAKES_DEFAULT = {
  conversation: '새 채팅을 시작할 때 이 프롬프트를 써요',
  translate: '번역 프롬프트를 선택하지 않은 채팅에 써요',
  memory: '장기 기억을 이 프롬프트로 정리해요',
  illustrate: '삽화 프롬프트를 선택하지 않은 채팅에 써요',
  mascot: '마스코트가 이 프롬프트로 대사를 써요',
  preread: '긴 내용을 미리 요약할 때 이 프롬프트를 써요',
  status: '응답 뒤에 상태를 기록할 때 이 프롬프트를 써요',
} satisfies Record<Exclude<PromptSort, 'agent'>, string>;

type Props = {
  stored: Stored<'prompt'>;
  // Opens another prompt: a copy just made, or the original of this copy.
  onOpen: (id: string) => void;
  // Leaves the prompt's own page, where the menu stands on it.
  onErased?: () => void;
  // The asker shows the export, which outlives this menu.
  onExport: () => void;
};

// What is done to a whole prompt, the items of its editor's ⋯ and of its card's right-click.
export function PromptMenu({ stored, onOpen, onErased, onExport }: Props) {
  const store = useStore();
  const toast = useToast();
  const removal = useRemoval();
  const making = useMaking();
  const settings = useSettings();
  const original = live(useStored('prompt', stored.value.origin?.id ?? null));
  // The prompt's one queue: what its editor has yet to save is stored before any of these.
  const save = useAutosave<PromptPatch>(`prompt:${stored.id}`, (patch) => editPrompt(store, stored.id, patch));
  const draft = { ...stored.value, ...save.unsaved };
  const sort = sortOf(stored.value);
  // An agent has no default: the chats whose lists hold it run it (runtime/tasks/agents).
  const words = sort === 'agent' ? null : { default: defaultPrompt(sort), makeDefault: MAKES_DEFAULT[sort] };
  const isDefault = isDefaultPrompt(settings, stored);

  const copy = () => making.copy({ flush: save.flush, name: () => promptName(draft.name), make: (name, made) => copyPrompt(store, stored.id, name, made), open: onOpen });
  const resetBlocks = async () => {
    if (!(await save.flush())) return;
    const { blocks, toggles } = draft;
    const reset = await resetPromptBlocks(store, stored.id);
    if (!reset.ok) return toast.failed(reset, '기본 블록으로 되돌리지 못했어요.');
    toast.undoable('기본 블록으로 되돌렸어요.', () => editPrompt(store, stored.id, { blocks, toggles }));
  };
  const makeDefault = async () => {
    const saved = await setDefaultPrompt(store, stored.id);
    if (!saved.ok) toast.failed(saved, SET_DEFAULT_FAILED);
  };
  const erase = () =>
    removal({ name: ({ value }) => promptName(value.name), noun: THINGS.prompt.noun, task: () => removePrompt(store, stored.id), queue: save.remove, restore: () => restorePrompt(store, stored.id), then: onErased, detail: BIN_KEEPS });

  return (
    <>
      {stored.value.origin && <MenuItem label={SEE_ORIGINAL} description={original ? undefined : ORIGINAL_GONE} disabled={!original} onClick={() => onOpen(stored.value.origin!.id)} />}
      <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void copy()} />
      {sort === 'conversation' && <MenuItem icon={ACTS.export.icon} label={ACTS.export.label} onClick={onExport} />}
      {words && !isDefault && <MenuItem label={SET_DEFAULT} description={words.makeDefault} onClick={() => void makeDefault()} />}
      {sort !== 'conversation' && <MenuItem label="기본 블록으로 되돌리기" onClick={() => void resetBlocks()} />}
      <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} description={isDefault ? cannotRemove(words!.default) : undefined} tone="warn" disabled={isDefault} onClick={() => void erase()} />
    </>
  );
}
