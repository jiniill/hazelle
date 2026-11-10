import { useEffect, useState } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import type { CharacterShelf, Removable } from '../../model/library';
import { exportCharacter } from '../../runtime/card-file';
import { copyCharacter, createCharacter, setDeleted } from '../../runtime/characters';
import { markDeleted, purgeNow } from '../../runtime/removal';
import { exportRisuChats } from '../../runtime/risu-export';
import { newOf } from '../common/acts';
import { fileNamed } from '../common/download';
import { runExport } from '../common/exporting';
import { BIN_KEEPS, COPY_SAID, copyName, moduleName, namedObject, promptName, RISU_CHAT_FILE, risuLeftOut, THINGS, TOOL } from '../common/words';
import { useFiles, useStore } from '../session';
import { navigate } from '../shell/router';
import { useRemoval } from '../common/useRemoval';
import { useToast } from '../toast';
import type { Editing } from './editing';
import { describeStep } from './saving';
import { withChats } from './shelf';

type Shelf = CharacterShelf<ChatSummary>;
export type CharacterActions = ReturnType<typeof useCharacterActions>;
// what is all that 영구 삭제 takes, as the object of 영구 삭제해요.
export type Binned = { kind: Removable; id: string; name: string; what: string };
const one = (kind: Exclude<Removable, 'character' | 'chat'>, id: string, name: string): Binned => ({ kind, id, name, what: namedObject(name, THINGS[kind].noun) });

export const binnedCharacter = (shelf: Shelf): Binned => {
  const name = shelf.character.card.name;
  return { kind: 'character', id: shelf.id, name, what: namedObject(name, withChats(shelf)) };
};

export const binnedChat = ({ id, title }: ChatSummary): Binned => ({ kind: 'chat', id, name: title, what: namedObject(title, THINGS.chat.noun) });
export const binnedModule = ({ id, value }: Stored<'module'>): Binned => one('module', id, moduleName(value.name));
export const binnedPrompt = ({ id, value }: Stored<'prompt'>): Binned => one('prompt', id, promptName(value.name));
export const binnedPersona = ({ id, value }: Stored<'persona'>): Binned => one('persona', id, value.name);
export const binnedProfile = ({ id, value }: Stored<'profile'>): Binned => one('profile', id, value.name);

// Characters just made, until their editor opens with the name to type over.
const made = new Set<string>();

export function useNewCharacter() {
  const store = useStore();
  const toast = useToast();
  return () => {
    const id = crypto.randomUUID();
    made.add(id);
    toast.settled(createCharacter(store, newOf(THINGS.character.noun), id), '캐릭터를 만들지 못했어요.');
    navigate({ kind: 'edit', character: id, part: 'profile' });
  };
}

export function useJustMade(id: string) {
  const just = made.has(id);
  useEffect(() => void made.delete(id), [id]);
  return just;
}

// editing: the open editor's queues, when the actions run from it.
export function useCharacterActions(editing?: Editing) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const removal = useRemoval();
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);
  // The character whose 링크로 공유 dialog is open (ShareDialog, which the screen holding these actions draws).
  const [sharing, setSharing] = useState<Shelf | null>(null);

  async function copy({ id, character }: Shelf) {
    setBusy({ id, label: '사본 만드는 중' });
    if (editing && !(await editing.flush())) return setBusy(null);
    const copied = await copyCharacter(store, id, copyName(character.card.name), (step) => setBusy({ id, label: describeStep(step) }));
    setBusy(null);
    if (!copied.ok) return toast.failed(copied, COPY_SAID.failed);
    toast.show(COPY_SAID.made);
    navigate({ kind: 'edit', character: copied.data });
  }

  function exportFile({ id, character }: Shelf) {
    runExport(
      toast,
      fileNamed(character.card.name, THINGS.character.noun, 'charx'),
      (output, progress) => exportCharacter(store, files, id, output, progress),
      (label) => setBusy(label === null ? null : { id, label }),
      ({ tools }) => toast.show(`${namedObject(character.card.name, THINGS.character.noun)} 내보냈어요.`, tools ? { detail: `${TOOL} ${tools}개는 빼고 내보냈어요.` } : undefined),
    );
  }

  function exportChats({ id, character }: Shelf) {
    runExport(
      toast,
      fileNamed(`${character.card.name}_all_chats`, THINGS.chat.noun, 'json'),
      (output, progress) => exportRisuChats({ store }, id, output, progress),
      (label) => setBusy(label === null ? null : { id, label }),
      (left) => toast.show(`'${character.card.name}'의 ${RISU_CHAT_FILE}을 내보냈어요.`, risuLeftOut(left) ? { detail: risuLeftOut(left) } : undefined),
    );
  }

  const remove = (shelf: Shelf) =>
    removal({ name: () => shelf.character.card.name, noun: withChats(shelf), task: () => setDeleted(store, shelf.id, Date.now()), queue: editing?.remove, restore: () => setDeleted(store, shelf.id, null), detail: BIN_KEEPS });

  function restore({ kind, id, name }: Binned) {
    toast.settled(markDeleted(store, kind, id, null));
    toast.show(`${namedObject(name, THINGS[kind].noun)} 복원했어요.`);
  }

  async function purge({ kind, id, name }: Binned) {
    setBusy({ id, label: '삭제 중' });
    const removed = await purgeNow(store, files, kind, id, (done, total) => setBusy({ id, label: `삭제 중 · ${done} / ${total}` }));
    setBusy(null);
    if (removed.ok) toast.show(`${namedObject(name, THINGS[kind].noun)} 영구 삭제했어요.`);
    else toast.failed(removed, '일부 항목을 삭제하지 못했어요.');
  }

  return { busy, copy, exportFile, exportChats, remove, restore, purge, sharing, share: setSharing, stopSharing: () => setSharing(null) };
}
